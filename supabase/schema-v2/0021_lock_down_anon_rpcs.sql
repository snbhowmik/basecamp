-- Basecamp v2 — take EXECUTE away from anon on RPCs that were never public
-- ============================================================
-- 0019 closed this for the document functions and said the wider sweep was
-- "worth doing as its own change, where it can be tested on its own". This is
-- that change, scoped to the functions that are actually reachable over
-- PostgREST and actually harmful. It is not the whole sweep: the helpers named
-- in the anon-facing pa_self_register policy are deliberately left alone,
-- because RLS predicates are evaluated with the CALLER's privileges and
-- revoking those would break student self-registration.
--
-- Three of these were live holes on a deployed instance, not theoretical:
--
--   claim_invite_emails()  — the worst. SECURITY DEFINER, no guard, and it
--     RETURNS invite_token. An unauthenticated caller received live invite
--     tokens plus the invitee's email, walked to /invite/<token> and
--     registered as that person at whatever level the invite granted. It also
--     increments invite_email_attempts, so repeat calls burn the 5-attempt
--     budget and permanently stop the real invite from ever being delivered.
--
--   search_people()        — SECURITY DEFINER over profiles/member_profiles
--     with no auth check at all. Verified against the running stack: an anon
--     key returned full names, personal email addresses, register numbers,
--     FET IDs and departments. That is R-01 in SECURITY.md, live.
--
--   upsert_role_tag()      — an unauthenticated write. Creates or relabels any
--     tag except 'admin'.
--
-- The mailer is unaffected: it connects as basecamp_mailer over a direct
-- libpq socket, not through PostgREST, so it is granted explicitly below.
-- Note the revoke has to name `public` as well as `anon` — the Supabase image
-- grants EXECUTE to PUBLIC by default, and basecamp_mailer was reaching these
-- through that, so revoking PUBLIC without the explicit grant would break
-- invite delivery.

-- 1. Invite mail plumbing — the mailer's, and nobody else's.
revoke execute on function claim_invite_emails(integer)        from public, anon, authenticated;
revoke execute on function mark_invite_email_sent(uuid)        from public, anon, authenticated;
revoke execute on function mark_invite_email_failed(uuid, text) from public, anon, authenticated;

grant execute on function claim_invite_emails(integer)         to basecamp_mailer;
grant execute on function mark_invite_email_sent(uuid)         to basecamp_mailer;
grant execute on function mark_invite_email_failed(uuid, text) to basecamp_mailer;

-- 2. The directory. Signed-in and MFA-verified, like every other read.
revoke execute on function search_people(text, text, uuid, integer) from public, anon;
grant  execute on function search_people(text, text, uuid, integer) to authenticated;

-- The grant above is one layer. 0016 is the standing lesson that one layer is
-- how the aal1 bypass happened, so the function gets its own guard too: a
-- password-only (aal1) session must not be able to enumerate the directory
-- any more than a logged-out one can.
--
-- Note the guard is `auth.uid() is not null AND mfa_satisfied()`, not
-- mfa_satisfied() alone. mfa_satisfied() returns TRUE when auth.uid() is null
-- — deliberately, because it is meant to gate step-up for a session that
-- exists, and its own comment says anon "is confined by its grants". So for
-- anon it is not a second layer at all; grants really were the only one.
create or replace function search_people(
  p_query       text,
  p_member_type text default null,
  p_org_unit_id uuid default null,
  p_limit       integer default 20
)
returns table (
  user_id uuid, full_name text, email text,
  reg_no text, fet_id text, org_unit_name text, rank_score integer
)
language sql stable security definer set search_path = public as $$
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
  where auth.uid() is not null
    and mfa_satisfied()
    and p.is_active
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

-- create or replace resets nothing about privileges, but the function is
-- re-stated here for clarity about what the API surface now is.
revoke execute on function search_people(text, text, uuid, integer) from public, anon;
grant  execute on function search_people(text, text, uuid, integer) to authenticated;

-- 3. Writes and internals that anon has no business calling. Each is either
-- reached only from inside another SECURITY DEFINER function (which runs as
-- its owner and needs no grant to the caller) or fired by a trigger (which
-- runs as the table owner regardless of who holds EXECUTE).
revoke execute on function upsert_role_tag(text, text)          from public, anon;
revoke execute on function blocking_references(text, uuid)      from public, anon;
revoke execute on function required_checks_outstanding(uuid)    from anon;
revoke execute on function assert_fresh_totp()                  from anon;

-- Trigger functions. Nothing should ever call these directly.
revoke execute on function handle_new_user()                    from public, anon, authenticated;
revoke execute on function sync_mfa_enrolled()                  from public, anon, authenticated;
revoke execute on function apply_pending_assignment()           from public, anon, authenticated;
revoke execute on function block_base_level_internal_comment()  from public, anon, authenticated;
revoke execute on function schedule_attachment_purge()          from public, anon, authenticated;
revoke execute on function enforce_member_profile_writes()      from public, anon, authenticated;
revoke execute on function add_configured_watchers()            from public, anon, authenticated;

-- Deliberately NOT revoked, and why:
--   get_invite_by_token()   accept-invite runs before there is a session
--   self_register()         the public student portal
--   list_public_org_units() \ the registration form's dropdowns, filled in
--   list_public_batches()   / before login
--   public_base_level()     same
--   verify_document()       public by design — PRD.md §14.4, someone holding
--                           a printed document must be able to check it
--   reg_no_matches_batch()  named in the pa_self_register policy, so it is
--                           evaluated as anon and must stay executable
--   check_allowed_domain()  trigger on auth.users, fires during signup
--   is_bootstrapping()      the first-boot wizard, before any account exists
--   in_org_subtree()        evaluated inside policies
