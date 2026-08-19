-- Basecamp v2 — require a completed second factor for everything
-- ============================================================
-- Fixes an authentication bypass: signing in with a password alone produced a
-- persisted aal1 session, and nothing below the frontend cared. LoginForm held
-- the TOTP step in React state only, so a page refresh re-entered through
-- App.tsx's bootstrap(), which never looked at the assurance level. The session
-- was already in localStorage by then and worked everywhere.
--
-- The database was no better. has_mfa() existed and was applied to admin write
-- RPCs, but no read policy required it, and neither did most action RPCs — a
-- password-only session could read every row it was entitled to AND call
-- forward_request(), create_and_submit_request(), add_comment(),
-- save_field_values(), create_invite() and revoke_invite(). decide_request()
-- was gated; forwarding a request to the next desk was not.
--
-- TWO LAYERS, deliberately:
--
--   1. require_mfa() wired to PostgREST's db-pre-request hook
--      (PGRST_DB_PRE_REQUEST in docker-compose.yml). This is the only place
--      that covers RPCs: they are `security definer` and so bypass RLS
--      entirely. It runs before every request, which also means every RPC
--      added later is covered without anyone remembering to add a guard.
--
--   2. mfa_satisfied() folded into every RLS policy below. The hook lives in
--      an environment variable, and a control that disappears when an env var
--      is dropped is not the authorization boundary CLAUDE.md says RLS is.
--      Layer 2 is what still holds if layer 1 is misconfigured.
--
-- COUPLING WARNING: docker-compose.yml sets PGRST_DB_PRE_REQUEST to
-- public.require_mfa. Dropping or renaming that function takes the whole REST
-- API down — PostgREST fails every request when its pre-request hook is
-- missing. Change both together, and apply this migration BEFORE restarting
-- rest with the new env var.

-- ============================================================
-- mfa_satisfied() — the predicate
-- ============================================================
-- Keyed on auth.mfa_factors.status directly rather than on the cached
-- profiles.mfa_enrolled flag: the flag is trigger-maintained, and the
-- authorization decision should not depend on a trigger having fired.
--
-- The aal1 carve-out is not a weakening — it is what makes enrollment
-- possible. Signup, invite acceptance and the first-boot wizard all run at
-- aal1 by necessity: the account cannot present a second factor before it has
-- one. GoTrue writes the factor row as 'unverified' at mfa.enroll() and only
-- flips it to 'verified' at the first successful mfa.verify(), so the window
-- closes exactly when the user gains something to step up with, and not one
-- request earlier. Requiring aal2 unconditionally would lock the wizard out
-- of its own MFA step.
create or replace function mfa_satisfied()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case
    -- No subject in the JWT: anon, which is confined by its grants and by the
    -- handful of policies that name it. Nothing to step up here.
    when auth.uid() is null then true
    -- service_role is trusted infrastructure (the mailer worker), and it
    -- reaches PostgREST through this same hook.
    when coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
      then true
    when coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'aal', '') = 'aal2'
      then true
    else not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.status = 'verified'
    )
  end;
$$;

-- ============================================================
-- require_mfa() — the PostgREST pre-request hook
-- ============================================================
-- Must be `returns void` and take no arguments; PostgREST calls it after
-- `set role`, so every role that can reach the API needs EXECUTE or that
-- role's requests all fail.
--
-- insufficient_privilege surfaces as 42501, which PostgREST renders as HTTP
-- 403 — distinguishable by the frontend from an ordinary permission denial by
-- its message.
create or replace function require_mfa()
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not mfa_satisfied() then
    raise insufficient_privilege
      using message = 'Two-factor authentication is required for this session.',
            detail  = 'This session was established with a password only. Verify your authenticator app to continue.';
  end if;
end;
$$;

grant execute on function mfa_satisfied() to anon, authenticated, service_role;
grant execute on function require_mfa()    to anon, authenticated, service_role;

-- ============================================================
-- Layer 2 — fold the predicate into every policy
-- ============================================================
-- Driven off pg_policies rather than off the CREATE POLICY statements in
-- 0003_rls.sql, because that file is stale: 0009_editing_and_deletes.sql
-- dropped the `_write` FOR ALL policies and replaced them with separate
-- _insert/_update policies. The catalog is the only accurate list.
--
-- Policies naming `anon` are skipped. There is exactly one — pa_self_register,
-- which is how a student creates their own pending assignment before any
-- account exists. Adding an MFA predicate to a policy written for
-- unauthenticated callers would break self-registration to no benefit; anon
-- has no factor to verify.
--
-- Re-runnable: policies already carrying the predicate are left alone.
do $$
declare
  r record;
  parts text;
begin
  for r in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and not ('anon' = any(roles))
      and coalesce(qual, '')       not like '%mfa_satisfied()%'
      and coalesce(with_check, '') not like '%mfa_satisfied()%'
    order by tablename, policyname
  loop
    parts := '';
    if r.qual is not null then
      parts := parts || format(' using ((%s) and mfa_satisfied())', r.qual);
    end if;
    if r.with_check is not null then
      parts := parts || format(' with check ((%s) and mfa_satisfied())', r.with_check);
    end if;

    -- A policy with neither expression cannot be altered and should not exist.
    if parts = '' then
      raise exception 'Policy %.% has no USING or WITH CHECK expression.', r.tablename, r.policyname;
    end if;

    execute format('alter policy %I on %I%s', r.policyname, r.tablename, parts);
  end loop;
end
$$;

notify pgrst, 'reload schema';
