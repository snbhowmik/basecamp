-- Basecamp v2.0.0 — Bootstrap, invites, and the request lifecycle
-- ============================================================
-- Depends on 0001–0003.
--
-- Two things share this file because they are the same idea: nothing here
-- trusts the client with authority.
--
--   * Account creation cascades by invitation, never by an admin setting
--     someone's password. Creating a user directly needs `service_role`,
--     which must never reach a browser, and this architecture deliberately
--     has no server-side component holding it. So an authorized person
--     declares "this email becomes an HOD of this programme" as a row, and
--     the invitee signs themselves up through the same flow the captain
--     used. A trigger grants the declared role on the way in.
--
--   * Every lifecycle action is a security definer RPC that re-checks
--     authorization internally, because SECURITY DEFINER bypasses the RLS
--     that would otherwise enforce it. `requested_by` is always auth.uid()
--     and never a parameter — accepting it would let anyone file as anyone.

-- ============================================================
-- PENDING ASSIGNMENTS — the invite
-- ============================================================

create table pending_assignments (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  level_id      uuid not null references priority_levels(id),
  org_unit_id   uuid references org_units(id),
  batch_id      uuid references batches(id),
  section_id    uuid references sections(id),
  tag_codes     text[] not null default '{}',
  role_kind     text not null default 'academic',
  member_type   text not null default 'staff' check (member_type in ('student', 'staff')),
  reg_no        text,
  fet_id        text,

  invite_token  uuid not null default gen_random_uuid() unique,
  invited_by    uuid references profiles(id),   -- null = self-registered
  created_at    timestamptz not null default now(),
  consumed_at   timestamptz,

  -- Delivery bookkeeping for the mailer worker.
  invite_email_sent_at    timestamptz,
  invite_email_claimed_at timestamptz,
  invite_email_attempts   int not null default 0,
  invite_email_error      text
);

-- Only ONE open invite per address at a time, not a permanent lifetime lock:
-- a blanket unique constraint would make it impossible to ever re-invite
-- someone whose invite expired or was revoked and recreated.
create unique index pending_assignments_open_email
  on pending_assignments (lower(email)) where consumed_at is null;

-- The mailer polls exactly these rows and no others.
create index pending_assignments_email_queue on pending_assignments (created_at)
  where consumed_at is null and invite_email_sent_at is null and invite_email_attempts < 5;

-- ============================================================
-- can_invite() — who may invite whom
-- ============================================================
-- Rank-based, not hardcoded to "Dean" or "HOD" by name, because priority
-- levels are not fixed roles. my_rank_in() scoped to the target's org unit:
-- an HOD may invite a mentor into their own programme and not into another.
create or replace function can_invite(p_level_id uuid, p_org_unit_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    has_tag('admin')
    or (
      p_org_unit_id is not null
      and my_rank_in(p_org_unit_id) is not null
      and my_rank_in(p_org_unit_id) < (select rank from priority_levels where id = p_level_id)
    );
$$;

grant execute on function can_invite(uuid, uuid) to authenticated;

-- ============================================================
-- Signup gate — runs on auth.users, before a profile exists
-- ============================================================
-- Placed at the lowest possible layer rather than trusting the UI: someone
-- hitting the GoTrue signup API directly still gets rejected. Requires both
-- an allowed domain AND a live invite, so signup is not open-to-anyone-on-
-- the-domain once the captain exists.
create or replace function check_allowed_domain()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_domain text := lower(split_part(new.email, '@', 2));
begin
  -- The captain is created before any domain or invite exists. Only the very
  -- first account may take this path: once a profile exists, every later
  -- signup needs an allowed domain and an open invitation, even if setup was
  -- abandoned before an admin tag was ever granted.
  if is_bootstrapping() and not exists (select 1 from profiles) then
    return new;
  end if;

  if not exists (select 1 from allowed_login_domains d where lower(d.domain) = v_domain and d.is_active) then
    raise exception 'Signups are not open for this email domain.';
  end if;

  if not exists (
    select 1 from pending_assignments pa
    where lower(pa.email) = lower(new.email) and pa.consumed_at is null
  ) then
    raise exception 'No open invitation exists for this address.';
  end if;

  return new;
end;
$$;

create trigger auth_users_check_domain before insert on auth.users
  for each row execute function check_allowed_domain();

-- ============================================================
-- apply_pending_assignment() — grants the declared role on signup
-- ============================================================
-- Fires on profiles insert (which handle_new_user() performs), so it runs
-- after the user genuinely exists. Fully server-side: no client ever holds
-- an elevated key, and no bootstrap-style RLS window is needed.
create or replace function apply_pending_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pa pending_assignments%rowtype;
  v_tag  text;
  v_tag_id uuid;
begin
  select * into pa from pending_assignments
  where lower(email) = lower(new.email) and consumed_at is null
  order by created_at limit 1;

  if not found then
    return new;
  end if;

  insert into role_assignments (user_id, level_id, org_unit_id, section_id, role_kind, is_primary, assigned_by)
  values (new.id, pa.level_id, pa.org_unit_id, pa.section_id, pa.role_kind, true, pa.invited_by);

  foreach v_tag in array pa.tag_codes loop
    select id into v_tag_id from tags where code = v_tag;
    if v_tag_id is not null then
      insert into user_tags (user_id, tag_id, granted_by)
      values (new.id, v_tag_id, pa.invited_by) on conflict do nothing;
    end if;
  end loop;

  insert into member_profiles (user_id, member_type, reg_no, fet_id, org_unit_id, batch_id, section_id, is_complete)
  values (
    new.id, pa.member_type, pa.reg_no, pa.fet_id,
    pa.org_unit_id, pa.batch_id, pa.section_id,
    case when pa.member_type = 'student' then pa.reg_no is not null else pa.fet_id is not null end
  );

  update pending_assignments set consumed_at = now() where id = pa.id;
  return new;
end;
$$;

create trigger profiles_apply_assignment after insert on profiles
  for each row execute function apply_pending_assignment();

-- ============================================================
-- Register-number validation (PRD-V2 §8.2)
-- ============================================================
-- Closes a real gap: v1 let a self-registering student pick any department
-- from a dropdown with nothing checking the claim. A batch that has no
-- prefix configured accepts anything, so this is opt-in per batch and does
-- not block an org that has not filled them in yet.
create or replace function reg_no_matches_batch(p_reg_no text, p_batch_id uuid)
returns boolean language sql stable set search_path = public as $$
  select coalesce(
    (select p_reg_no is not null and upper(p_reg_no) like upper(b.reg_no_prefix) || '%'
     from batches b where b.id = p_batch_id and b.reg_no_prefix is not null),
    true
  );
$$;

-- ============================================================
-- Invite lookup and public catalog
-- ============================================================
-- Anon-callable, and deliberately narrow: someone holding a token sees who
-- invited them and to what, never the table and never another invite.
create or replace function get_invite_by_token(p_token uuid)
returns table (email text, level_name text, org_unit_name text, invited_by_name text)
language sql security definer stable set search_path = public as $$
  select pa.email, pl.name, ou.name, p.full_name
  from pending_assignments pa
  join priority_levels pl on pl.id = pa.level_id
  left join org_units ou on ou.id = pa.org_unit_id
  left join profiles  p  on p.id  = pa.invited_by
  where pa.invite_token = p_token and pa.consumed_at is null;
$$;

-- The registration form needs these before a session exists, so they go
-- through definer RPCs rather than table reads — the catalog tables all
-- require authentication to select.
create or replace function list_public_org_units()
returns table (id uuid, name text)
language sql security definer stable set search_path = public as $$
  select ou.id, ou.name from org_units ou
  where ou.is_active and ou.unit_type = 'programme' order by ou.name;
$$;

create or replace function list_public_batches(p_org_unit_id uuid)
returns table (id uuid, name text)
language sql security definer stable set search_path = public as $$
  select b.id, b.name from batches b
  where b.org_unit_id = p_org_unit_id and b.is_active order by b.start_year desc;
$$;

grant execute on function get_invite_by_token(uuid), list_public_org_units(), list_public_batches(uuid)
  to anon, authenticated;

-- ============================================================
-- PEOPLE SEARCH — register number first (PRD-V2 §11.2)
-- ============================================================
-- Ranking matters more than matching here. At 8,000 students a name query
-- returns a wall; an ID query must return one row at the top, every time.
-- v1 searched name and email only, which is why nobody could be found by
-- the handle people actually quote out loud.
create or replace function search_people(
  p_query       text,
  p_member_type text default null,
  p_org_unit_id uuid default null,
  p_limit       int  default 20
)
returns table (
  user_id uuid, full_name text, email text,
  reg_no text, fet_id text, org_unit_name text, rank_score int
)
language sql security definer stable set search_path = public as $$
  select p.id, p.full_name, p.email, mp.reg_no, mp.fet_id, ou.name,
    case
      when upper(mp.reg_no) = upper(p_query) or upper(mp.fet_id) = upper(p_query) then 0
      when upper(mp.reg_no) like upper(p_query) || '%'
        or upper(mp.fet_id) like upper(p_query) || '%' then 1
      when p.full_name ilike p_query || '%' then 2
      else 3
    end as rank_score
  from profiles p
  left join member_profiles mp on mp.user_id = p.id
  left join org_units ou on ou.id = mp.org_unit_id
  where p.is_active
    and (p_member_type is null or mp.member_type = p_member_type)
    and (p_org_unit_id is null or (mp.org_unit_id is not null and in_org_subtree(p_org_unit_id, mp.org_unit_id)))
    and (
      upper(mp.reg_no) like upper(p_query) || '%'
      or upper(mp.fet_id) like upper(p_query) || '%'
      or p.full_name ilike '%' || p_query || '%'
      or p.email ilike p_query || '%'
    )
  order by rank_score, p.full_name
  limit least(p_limit, 50);
$$;

grant execute on function search_people(text, text, uuid, int) to authenticated;

-- Who may a request of this category go to first. Scoped to the requester's
-- own subtree so a student cannot route into another programme.
create or replace function list_first_hop_candidates(p_category_id uuid)
returns table (user_id uuid, full_name text, email text, option_label text)
language sql security definer stable set search_path = public as $$
  select p.id, p.full_name, p.email, o.label
  from category_first_hop_options o
  join user_tags ut on ut.tag_id = o.tag_id
  join profiles p on p.id = ut.user_id and p.is_active
  left join member_profiles mp on mp.user_id = p.id
  left join member_profiles me on me.user_id = auth.uid()
  where o.category_id = p_category_id
    and (
      mp.org_unit_id is null
      or me.org_unit_id is null
      or in_org_subtree(mp.org_unit_id, me.org_unit_id)
      or in_org_subtree(me.org_unit_id, mp.org_unit_id)
    )
  order by o.sort_order, p.full_name;
$$;

-- Open search-and-forward across staff. Calls is_lowest_level() rather than
-- inlining a rank comparison — v1 inlined `rank < max(rank)` here, which
-- duplicated the fragile base-level assumption in a second place and broke
-- entirely on a single-level instance (SECURITY.md R-27, ARCH.md §4).
create or replace function search_forward_targets(p_query text)
returns table (user_id uuid, full_name text, email text, reg_no text, fet_id text)
language sql security definer stable set search_path = public as $$
  select s.user_id, s.full_name, s.email, s.reg_no, s.fet_id
  from search_people(p_query, null, null, 20) s
  where exists (
    select 1 from role_assignments ra
    join priority_levels pl on pl.id = ra.level_id
    where ra.user_id = s.user_id
      and assignment_is_current(ra.valid_from, ra.valid_until)
      and not pl.is_base
  )
  and s.user_id <> auth.uid();
$$;

grant execute on function list_first_hop_candidates(uuid), search_forward_targets(text) to authenticated;

-- ============================================================
-- WATCHERS — derived from configuration, not hardcoded
-- ============================================================
-- v1 always added the mentor and HOD by resolving them in a trigger. v2
-- reads category_level_roles, so a category can inform whichever levels it
-- says and no others. This is what makes the techfest flow expressible:
-- mentor and HOD notified, neither blocking.
create or replace function add_configured_watchers()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'submitted' and coalesce(old.status, 'draft') = 'draft' then
    insert into request_watchers (request_id, user_id, reason)
    select distinct new.id, ra.user_id, 'notified_level'
    from category_level_roles clr
    join role_assignments ra on ra.level_id = clr.level_id
      and assignment_is_current(ra.valid_from, ra.valid_until)
    where clr.category_id = new.category_id
      and clr.participation = 'notified'
      and (
        ra.org_unit_id is null
        or new.org_unit_id is null
        or in_org_subtree(ra.org_unit_id, new.org_unit_id)
      )
      and ra.user_id <> new.requested_by
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger requests_add_watchers after update of status on requests
  for each row execute function add_configured_watchers();

-- ============================================================
-- LIFECYCLE RPCs
-- ============================================================

-- Blocks a forward while the current level still has unsatisfied required
-- checks. Flat — no dependencies between checks (D-5).
create or replace function required_checks_outstanding(p_request_id uuid)
returns int language sql security definer stable set search_path = public as $$
  select count(*)::int
  from requests r
  join level_checks lc on lc.is_required
    and lc.level_id = r.current_level_id
    and (lc.category_id is null or lc.category_id = r.category_id)
  where r.id = p_request_id
    and not exists (
      select 1 from request_check_results rr
      where rr.request_id = r.id and rr.check_id = lc.id and rr.result = 'passed'
    );
$$;

grant execute on function required_checks_outstanding(uuid) to authenticated;

create or replace function create_and_submit_request(
  p_category_id uuid,
  p_title       text,
  p_body        text,
  p_first_hop   uuid,
  p_acted_as    uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_mode decision_mode;
  v_org uuid;
  v_ref text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  -- Copied at creation and never updated afterwards, so editing a category
  -- later cannot retroactively change tickets already in flight.
  select rt.decision_mode into v_mode
  from request_categories rc join request_types rt on rt.id = rc.request_type_id
  where rc.id = p_category_id;

  if v_mode is null then
    raise exception 'Unknown request category.';
  end if;

  select org_unit_id into v_org from member_profiles where user_id = auth.uid();
  v_ref := 'REQ-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into requests (
    reference_number, category_id, decision_mode, requested_by, requested_as,
    title, body, status, current_holder, org_unit_id, submitted_at
  )
  values (
    v_ref, p_category_id, v_mode, auth.uid(), p_acted_as,
    p_title, p_body, 'draft', p_first_hop, v_org, now()
  )
  returning id into v_id;

  -- Separate update so the watcher trigger sees a draft → submitted
  -- transition rather than an insert.
  update requests set status = 'submitted' where id = v_id;

  insert into request_assignment_history (request_id, from_user, to_user, acted_by, acted_as, action)
  values (v_id, auth.uid(), p_first_hop, auth.uid(), p_acted_as, 'submitted');

  return v_id;
end;
$$;

create or replace function decide_request(
  p_request_id uuid,
  p_decision   text,
  p_note       text default null,
  p_acted_as   uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  r requests%rowtype;
  v_hash text;
begin
  select * into r from requests where id = p_request_id;
  if not found then raise exception 'No such request.'; end if;

  -- SECURITY DEFINER bypasses RLS, so holder identity is re-checked here.
  if r.current_holder <> auth.uid() and not has_tag('admin') then
    raise exception 'This request is not on your desk.';
  end if;

  -- Deciding is a sensitive action; it requires a completed second factor.
  if not has_mfa() then
    raise exception 'Two-factor authentication is required to decide a request.';
  end if;

  if required_checks_outstanding(p_request_id) > 0 then
    raise exception 'Required checks for this level are still outstanding.';
  end if;

  if p_decision not in ('approved', 'rejected', 'changes_requested') then
    raise exception 'Unknown decision.';
  end if;

  -- Computed server-side from the row as stored. A client-supplied hash
  -- proves nothing about what was actually signed.
  v_hash := encode(digest(
    coalesce(r.reference_number,'') || coalesce(r.title,'') || coalesce(r.body,'') || r.category_id::text,
    'sha256'), 'hex');

  -- log_only categories are acknowledged without a signature: there is no
  -- decision to countersign, only a review that happened.
  if r.decision_mode = 'approval' then
    insert into signatures (request_id, signer_id, acted_as, level_id, decision, state_hash, note)
    values (p_request_id, auth.uid(), p_acted_as, r.current_level_id, p_decision, v_hash, p_note);
  end if;

  update requests
  set status = case
        when p_decision = 'approved' then (case when r.decision_mode = 'log_only' then 'reviewed' else 'approved' end)::request_status
        when p_decision = 'rejected' then 'rejected'::request_status
        else 'changes_requested'::request_status
      end,
      current_holder = case when p_decision = 'changes_requested' then r.requested_by else null end,
      closed_at = case when p_decision in ('approved', 'rejected') then now() else null end
  where id = p_request_id;

  insert into request_assignment_history (request_id, from_user, to_user, acted_by, acted_as, action, note)
  values (p_request_id, auth.uid(), null, auth.uid(), p_acted_as, p_decision, p_note);
end;
$$;

create or replace function forward_request(
  p_request_id uuid,
  p_to_user    uuid,
  p_note       text default null,
  p_acted_as   uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare r requests%rowtype;
begin
  select * into r from requests where id = p_request_id;
  if not found then raise exception 'No such request.'; end if;

  if r.current_holder <> auth.uid() and not has_tag('admin') then
    raise exception 'This request is not on your desk.';
  end if;

  if required_checks_outstanding(p_request_id) > 0 then
    raise exception 'Complete this level''s required checks before forwarding.';
  end if;

  update requests
  set current_holder = p_to_user,
      status = 'in_review',
      -- The level the ticket now sits at is the recipient's most senior
      -- current assignment. required_checks_outstanding() reads this to
      -- decide which level's checks gate the next hop, so getting it wrong
      -- would gate against the wrong checklist entirely.
      current_level_id = (
        select pl.id
        from role_assignments ra
        join priority_levels pl on pl.id = ra.level_id
        where ra.user_id = p_to_user
          and assignment_is_current(ra.valid_from, ra.valid_until)
        order by pl.rank
        limit 1
      )
  where id = p_request_id;

  insert into request_assignment_history (request_id, from_user, to_user, acted_by, acted_as, action, note)
  values (p_request_id, auth.uid(), p_to_user, auth.uid(), p_acted_as, 'forwarded', p_note);
end;
$$;

grant execute on function create_and_submit_request(uuid, text, text, uuid, uuid) to authenticated;
grant execute on function decide_request(uuid, text, text, uuid) to authenticated;
grant execute on function forward_request(uuid, uuid, text, uuid) to authenticated;

-- ============================================================
-- RLS ON PENDING ASSIGNMENTS
-- ============================================================

alter table pending_assignments enable row level security;
alter table pending_assignments force row level security;

create policy pa_read on pending_assignments for select
  to authenticated using (invited_by = auth.uid() or has_tag('admin'));

create policy pa_insert on pending_assignments for insert
  to authenticated with check (invited_by = auth.uid() and can_invite(level_id, org_unit_id));

create policy pa_delete on pending_assignments for delete
  to authenticated using (invited_by = auth.uid() or has_tag('admin'));

-- Self-registration: anyone, including anon, may declare an invite for
-- themselves — but only at the base level, scoped to a programme, with no
-- staff tags. Deliberately not identity-checked, because the caller has no
-- session yet; the real check is still owning the inbox at confirmation,
-- the same trust model open signup always had.
create policy pa_self_register on pending_assignments for insert
  to anon, authenticated with check (
    invited_by is null
    and org_unit_id is not null
    and member_type = 'student'
    and coalesce(array_length(tag_codes, 1), 0) = 0
    and level_id = (select id from priority_levels where is_base limit 1)
    and reg_no_matches_batch(reg_no, batch_id)
  );

-- ============================================================
-- MAILER — least-privileged role for the invite email worker
-- ============================================================
-- Created NOLOGIN: a password in a migration is a password in git.
-- scripts/bootstrap-db-roles.sh sets it from .env, which is why that script
-- must be run again AFTER migrations.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'basecamp_mailer') then
    create role basecamp_mailer nologin;
  end if;
end
$$;

grant usage on schema public to basecamp_mailer;

-- Claim-then-send, not send-then-mark: a worker that dies mid-send must not
-- leave a row that re-sends on every subsequent poll. SKIP LOCKED so two
-- replicas can never claim the same row.
create or replace function claim_invite_emails(p_limit int default 20)
returns table (id uuid, email text, invite_token uuid, level_name text, org_unit_name text, invited_by_name text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with claimed as (
    select pa.id from pending_assignments pa
    where pa.consumed_at is null
      and pa.invite_email_sent_at is null
      and pa.invite_email_attempts < 5
      and (pa.invite_email_claimed_at is null or pa.invite_email_claimed_at < now() - interval '5 minutes')
    order by pa.created_at limit p_limit
    for update skip locked
  )
  update pending_assignments pa
  set invite_email_claimed_at = now(), invite_email_attempts = pa.invite_email_attempts + 1
  from claimed c where pa.id = c.id
  returning pa.id, pa.email, pa.invite_token,
    (select pl.name from priority_levels pl where pl.id = pa.level_id),
    (select ou.name from org_units ou where ou.id = pa.org_unit_id),
    (select p.full_name from profiles p where p.id = pa.invited_by);
end;
$$;

create or replace function mark_invite_email_sent(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update pending_assignments set invite_email_sent_at = now(), invite_email_error = null where id = p_id;
$$;

create or replace function mark_invite_email_failed(p_id uuid, p_error text)
returns void language sql security definer set search_path = public as $$
  update pending_assignments set invite_email_error = left(p_error, 500) where id = p_id;
$$;

create or replace function resend_invite_email(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from pending_assignments
    where id = p_id and consumed_at is null and (invited_by = auth.uid() or has_tag('admin'))
  ) then
    raise exception 'Not allowed to resend this invite.';
  end if;

  update pending_assignments
  set invite_email_sent_at = null, invite_email_claimed_at = null,
      invite_email_attempts = 0, invite_email_error = null
  where id = p_id;
end;
$$;

-- claim_invite_emails() returns live tokens and addresses — exactly the
-- payload for hijacking a pending staff invite. The mailer role gets these
-- three functions and no table privileges at all.
revoke execute on function claim_invite_emails(int) from public;
revoke execute on function mark_invite_email_sent(uuid) from public;
revoke execute on function mark_invite_email_failed(uuid, text) from public;

grant execute on function claim_invite_emails(int) to basecamp_mailer;
grant execute on function mark_invite_email_sent(uuid) to basecamp_mailer;
grant execute on function mark_invite_email_failed(uuid, text) to basecamp_mailer;
grant execute on function resend_invite_email(uuid) to authenticated;

-- ============================================================
-- Re-run the enumerated RLS check — this file added a table
-- ============================================================
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ') into missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if missing is not null then
    raise exception 'Tables in public without RLS enabled: %', missing;
  end if;
end
$$;
