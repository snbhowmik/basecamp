-- Basecamp v2.0.0 — Row Level Security
-- ============================================================
-- Depends on 0001_foundation.sql and 0002_requests.sql.
--
-- This is the file that actually enforces authorization. Everything the
-- frontend does about permissions is presentation; this is the boundary.
--
-- THE RANK RULE, which is the whole reason v2's authorization is riskier
-- than v1's. v1 had one `my_rank()` returning a single scalar, because a
-- user had exactly one level. v2 splits it, and choosing wrong is an
-- authorization hole that RLS will enforce confidently and silently:
--
--   my_best_rank()        most senior rank held ANYWHERE. Use only for
--                         coarse "may this person reach the admin area at
--                         all" checks. Never to decide authority over a
--                         specific row.
--   my_rank_in(org_unit)  rank within that part of the org. Use for
--                         everything row-scoped. An HOD of Cyber Security
--                         outranks a Cyber student and NOT an AIML one,
--                         and only this function can tell the difference.
--
-- Every policy below states which it uses and why. A policy that reaches
-- for my_best_rank() on a row-scoped decision is the bug this comment
-- exists to prevent.
--
-- FORCE ROW LEVEL SECURITY everywhere, not merely ENABLE: plain ENABLE does
-- not apply to a table's owner, so if the connecting role ever turns out to
-- own these tables the whole model would be silently bypassed.

-- ============================================================
-- can_see_request() — the single definition of request visibility
-- ============================================================
-- Written once and reused by every request-related table's policies.
-- Referencing an RLS-protected table from inside another table's policy is
-- how recursive-policy surprises happen, which is why this is a security
-- definer function rather than a repeated subquery.
create or replace function can_see_request(p_request_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from requests r
    where r.id = p_request_id and (
      -- Your own ticket, or it is sitting with you right now.
      r.requested_by = auth.uid()
      or r.current_holder = auth.uid()
      -- You are a named participant (group requests).
      or exists (select 1 from request_participants p where p.request_id = r.id and p.member_id = auth.uid())
      -- You were informed (a `notified` level), or you have held it before.
      or exists (select 1 from request_watchers w where w.request_id = r.id and w.user_id = auth.uid())
      or exists (select 1 from request_assignment_history h where h.request_id = r.id and h.to_user = auth.uid())
      -- The default rule: you outrank the ticket's scope, within it.
      -- my_rank_in(), never my_best_rank() — a mentor in one programme must
      -- not see another programme's tickets by virtue of holding a rank.
      or (
        r.org_unit_id is not null
        and my_rank_in(r.org_unit_id) is not null
        and my_rank_in(r.org_unit_id) < coalesce(
          (select pl.rank from priority_levels pl where pl.id = r.current_level_id), 2147483647
        )
      )
      -- Configured exceptions: peers seeing peers, listed or search-only.
      -- Both modes are visible here; the *list vs search* distinction is
      -- applied by the query layer, not by RLS, because RLS cannot know
      -- whether it is answering a list or a lookup.
      or exists (
        select 1
        from level_visibility_rules v
        join role_assignments ra on ra.user_id = auth.uid()
          and assignment_is_current(ra.valid_from, ra.valid_until)
        where v.viewer_level_id = ra.level_id
          and v.target_level_id = r.current_level_id
          and v.mode <> 'none'
          and (v.scope = 'any' or (r.org_unit_id is not null and in_org_subtree(ra.org_unit_id, r.org_unit_id)))
      )
      or has_tag('admin')
    )
  );
$$;

grant execute on function can_see_request(uuid) to authenticated;

-- ============================================================
-- IDENTITY
-- ============================================================

alter table profiles enable row level security;
alter table profiles force row level security;

-- Names and emails of people you share the org with are not secret — you
-- have to be able to address a ticket to someone. CGPA and academic records
-- are NOT here; those live on member_profiles and are gated separately.
create policy profiles_read on profiles for select
  to authenticated using (true);

create policy profiles_update_self on profiles for update
  to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ============================================================
-- MEMBER PROFILES — the Tier 1 / Tier 2 split (PRD-V2 §9.2)
-- ============================================================
-- RLS is row-level; it cannot hide the cgpa column from someone allowed to
-- read the row. So the row itself is restricted to self and outranking
-- staff, and the peer-visible Tier 1 card is served by an RPC that selects
-- only safe columns. A peer on a group request must be able to see who they
-- are filing with, and must NOT be able to see that person's CGPA.

alter table member_profiles enable row level security;
alter table member_profiles force row level security;

create policy member_profiles_read_self on member_profiles for select
  to authenticated using (user_id = auth.uid());

-- Staff who outrank this member within their own org unit. my_rank_in(),
-- scoped to the member's unit — a mentor in another programme gets nothing.
create policy member_profiles_read_staff on member_profiles for select
  to authenticated using (
    org_unit_id is not null
    and my_rank_in(org_unit_id) is not null
    and my_rank_in(org_unit_id) < coalesce((select min(pl.rank)
        from role_assignments ra join priority_levels pl on pl.id = ra.level_id
        where ra.user_id = member_profiles.user_id
          and assignment_is_current(ra.valid_from, ra.valid_until)), 2147483647)
  );

create policy member_profiles_read_admin on member_profiles for select
  to authenticated using (has_tag('admin'));

-- A student may maintain their own record. RLS gates the ROW, not the
-- columns — so this policy alone would let them set their own CGPA, stamp
-- their own verification, or move themselves into another programme. The
-- column rules live in the trigger below, which is the only thing standing
-- between "may edit my row" and "may edit anything on my row".
create policy member_profiles_update_self on member_profiles for update
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy member_profiles_update_staff on member_profiles for update
  to authenticated using (
    has_tag('admin')
    or (org_unit_id is not null and my_rank_in(org_unit_id) is not null)
  );

-- ============================================================
-- Column-level rules for member_profiles (PRD-V2 §9.3)
-- ============================================================
-- Postgres RLS cannot express "this user may write column A but not column
-- B", so this trigger does. It is the enforcement point for the whole CGPA
-- lifecycle: collection windows, the verification lock, and the rule that
-- academic data is written only in an academic capacity.
create or replace function enforce_member_profile_writes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_is_self  boolean := old.user_id = auth.uid();
  v_is_staff boolean := has_tag('admin')
                        or (old.org_unit_id is not null and my_rank_in(old.org_unit_id) is not null
                            and my_rank_in(old.org_unit_id) < coalesce((
                              select min(pl.rank) from role_assignments ra
                              join priority_levels pl on pl.id = ra.level_id
                              where ra.user_id = old.user_id
                                and assignment_is_current(ra.valid_from, ra.valid_until)), 2147483647));
  v_window_open boolean;
begin
  -- Placement and identity are never self-service. A student moving
  -- themselves into another programme would inherit that programme's
  -- visibility, which is an authorization change wearing a profile edit.
  if v_is_self and not v_is_staff then
    if new.org_unit_id is distinct from old.org_unit_id
       or new.batch_id  is distinct from old.batch_id
       or new.section_id is distinct from old.section_id
       or new.member_type is distinct from old.member_type
       or new.reg_no is distinct from old.reg_no
       or new.fet_id is distinct from old.fet_id
       or new.is_complete is distinct from old.is_complete then
      raise exception 'Placement and identity fields are set by staff, not by you.';
    end if;

    -- Nobody verifies their own CGPA.
    if new.cgpa_verified_by is distinct from old.cgpa_verified_by
       or new.cgpa_verified_at is distinct from old.cgpa_verified_at then
      raise exception 'CGPA verification is recorded by a mentor.';
    end if;

    if new.cgpa is distinct from old.cgpa or new.cgpa_proof_key is distinct from old.cgpa_proof_key then
      -- Once a mentor has verified it, the student cannot change it at all,
      -- window open or not. They ask a human instead.
      if old.cgpa_verified_by is not null then
        raise exception 'This CGPA has been verified. Ask your mentor to change it.';
      end if;

      select exists (
        select 1 from cgpa_windows w
        where now() between w.opens_at and w.closes_at
          and (w.org_unit_id is null
               or (old.org_unit_id is not null and in_org_subtree(w.org_unit_id, old.org_unit_id)))
      ) into v_window_open;

      if not v_window_open then
        raise exception 'CGPA submission is closed right now.';
      end if;

      new.cgpa_updated_at := now();
    end if;

  elsif v_is_staff then
    -- Academic data is written in an academic capacity. The same person
    -- acting as a club coordinator holds the rank but not the authority
    -- (PRD-V2 §10) — this is where the recorded capacity becomes a rule.
    if (new.cgpa is distinct from old.cgpa
        or new.cgpa_verified_by is distinct from old.cgpa_verified_by
        or new.org_unit_id is distinct from old.org_unit_id
        or new.batch_id is distinct from old.batch_id
        or new.section_id is distinct from old.section_id)
       and not (holds_kind('academic') or has_tag('admin')) then
      raise exception 'Academic records can only be changed in an academic role.';
    end if;

    if new.cgpa is distinct from old.cgpa then
      new.cgpa_updated_at := now();
    end if;

  else
    raise exception 'Not allowed to modify this profile.';
  end if;

  return new;
end;
$$;

create trigger member_profiles_column_rules before update on member_profiles
  for each row execute function enforce_member_profile_writes();

-- Tier 1: identity plus counts, for anyone who shares a request with them.
-- Deliberately returns no CGPA at all rather than nulling it, so a future
-- caller cannot accidentally surface it.
create or replace function get_member_card(p_user_id uuid)
returns table (
  user_id uuid, full_name text, reg_no text, fet_id text,
  org_unit_name text, batch_name text, section_name text,
  tech_count bigint, non_tech_count bigint
)
language sql security definer stable set search_path = public as $$
  select
    p.id, p.full_name, mp.reg_no, mp.fet_id,
    ou.name, b.name, s.name,
    (select count(*) from requests r
       join request_categories rc on rc.id = r.category_id
      where r.requested_by = p.id and rc.classification = 'tech'
        and r.status in ('approved', 'reviewed', 'closed')),
    (select count(*) from requests r
       join request_categories rc on rc.id = r.category_id
      where r.requested_by = p.id and rc.classification = 'non_tech'
        and r.status in ('approved', 'reviewed', 'closed'))
  from profiles p
  left join member_profiles mp on mp.user_id = p.id
  left join org_units ou on ou.id = mp.org_unit_id
  left join batches   b  on b.id  = mp.batch_id
  left join sections  s  on s.id  = mp.section_id
  where p.id = p_user_id
    and (
      p.id = auth.uid()
      or has_tag('admin')
      -- Shares at least one request with the caller.
      or exists (
        select 1 from request_participants rp
        join request_participants mine on mine.request_id = rp.request_id
        where rp.member_id = p_user_id and mine.member_id = auth.uid()
      )
      or exists (
        select 1 from requests r
        where (r.requested_by = p_user_id and can_see_request(r.id))
      )
    );
$$;

grant execute on function get_member_card(uuid) to authenticated;

-- ============================================================
-- ORG STRUCTURE — readable by everyone signed in, written by admin
-- ============================================================
-- Students pick a department and batch when they register, so these have to
-- be readable. They are org shape, not personal data.

do $$
declare t text;
begin
  foreach t in array array[
    'priority_levels','tags','user_tags','org_units','batches','sections',
    'allowed_login_domains','cgpa_windows','role_assignments'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
    -- Bootstrap-or-admin: is_bootstrapping() is true only until the first
    -- admin tag exists, which is the window the setup wizard runs in.
    execute format(
      'create policy %I on %I for all to authenticated using (has_tag(''admin'') or is_bootstrapping()) '
      'with check (has_tag(''admin'') or is_bootstrapping())', t || '_write', t);
  end loop;
end
$$;

-- ============================================================
-- CATALOG — request types, categories, routing, checks, rules
-- ============================================================
-- Readable by any signed-in user (you cannot file against a category you
-- cannot see); writable by admin only.

do $$
declare t text;
begin
  foreach t in array array[
    'request_types','request_categories','category_first_hop_options',
    'category_level_roles','level_checks','level_visibility_rules','field_definitions'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
    execute format(
      'create policy %I on %I for all to authenticated using (has_tag(''admin'') or is_bootstrapping()) '
      'with check (has_tag(''admin'') or is_bootstrapping())', t || '_write', t);
  end loop;
end
$$;

-- ============================================================
-- REQUESTS AND EVERYTHING HANGING OFF THEM
-- ============================================================

alter table requests enable row level security;
alter table requests force row level security;

create policy requests_read on requests for select
  to authenticated using (can_see_request(id));

-- Creation is via create_and_submit_request(), which is security definer and
-- re-checks authorization itself. This policy exists so a draft can be made;
-- requested_by is forced to auth.uid() so nobody can file as someone else.
create policy requests_insert on requests for insert
  to authenticated with check (requested_by = auth.uid());

-- Deliberately narrow: the holder moves a ticket, the owner edits a draft.
-- Everything else (deciding, forwarding) goes through the RPCs in 0004,
-- which enforce MFA and capacity.
create policy requests_update on requests for update
  to authenticated using (
    current_holder = auth.uid()
    or (requested_by = auth.uid() and status = 'draft')
    or has_tag('admin')
  );

-- Child tables all gate on can_see_request(), so visibility is defined once.
do $$
declare t text;
begin
  foreach t in array array[
    'request_assignment_history','request_watchers','request_participants',
    'request_check_results','request_attachments','generated_documents'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for select to authenticated using (can_see_request(request_id))', t || '_read', t);
  end loop;
end
$$;

-- Writes on the children are narrower than reads.

create policy participants_write on request_participants for insert
  to authenticated with check (
    exists (select 1 from requests r where r.id = request_id and r.requested_by = auth.uid())
  );

-- A participant accepts or declines their own membership of a group request;
-- the mentor records parent consent. Two different people, one table.
create policy participants_update on request_participants for update
  to authenticated using (
    member_id = auth.uid()
    or exists (select 1 from requests r where r.id = request_id and r.current_holder = auth.uid())
    or has_tag('admin')
  );

-- Checks are ticked by whoever currently holds the ticket, acting in an
-- academic capacity — a club coordinator holding the same rank must not tick
-- an academic verification (PRD-V2 §10).
create policy check_results_write on request_check_results for insert
  to authenticated with check (
    acted_by = auth.uid()
    and holds_kind('academic')
    and exists (select 1 from requests r where r.id = request_id and r.current_holder = auth.uid())
  );

create policy attachments_write on request_attachments for insert
  to authenticated with check (uploaded_by = auth.uid() and can_see_request(request_id));

-- Custom field values follow their request exactly.
alter table request_field_values enable row level security;
alter table request_field_values force row level security;

create policy rfv_read on request_field_values for select
  to authenticated using (can_see_request(request_id));

create policy rfv_write on request_field_values for insert
  to authenticated with check (
    exists (select 1 from requests r where r.id = request_id and r.requested_by = auth.uid())
  );

create policy rfv_update on request_field_values for update
  to authenticated using (
    exists (select 1 from requests r
            where r.id = request_id and r.requested_by = auth.uid() and r.status = 'draft')
  );

-- ============================================================
-- COMMENTS — the public/internal split
-- ============================================================

alter table request_comments enable row level security;
alter table request_comments force row level security;

-- Internal notes are invisible to base-level users. The insert trigger in
-- 0002 already makes it impossible for them to write one; this stops them
-- reading staff notes on their own ticket.
create policy comments_read on request_comments for select
  to authenticated using (
    can_see_request(request_id)
    and (visibility = 'public' or not is_lowest_level())
  );

create policy comments_write on request_comments for insert
  to authenticated with check (author_id = auth.uid() and can_see_request(request_id));

-- ============================================================
-- SIGNATURES
-- ============================================================

alter table signatures enable row level security;
alter table signatures force row level security;

create policy signatures_read on signatures for select
  to authenticated using (can_see_request(request_id));

-- Written only by decide_request() (0004). No direct client insert path:
-- state_hash must be computed server-side from the row as stored, and a
-- client-supplied hash proves nothing about what was signed.

alter table signature_assets enable row level security;
alter table signature_assets force row level security;

-- Narrower than v1, which let any staff member read anyone's signature image
-- (SECURITY.md R-26). Own signature only; document generation reads it
-- through a security definer function instead of by table access.
create policy signature_assets_own on signature_assets for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- A CHECK, NOT A COMMENT
-- ============================================================
-- v1 shipped request_field_values with no RLS at all: missed by the file
-- that covered the other request tables and by the one that covered the
-- catalog, and PostgREST exposes anything in `public` (SECURITY.md R-28).
-- The lesson recorded there was that this must be enumerated mechanically
-- rather than maintained by hand, so the migration fails loudly here rather
-- than shipping a readable table.
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ')
  into missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if missing is not null then
    raise exception 'Tables in public without RLS enabled: %', missing;
  end if;
end
$$;
