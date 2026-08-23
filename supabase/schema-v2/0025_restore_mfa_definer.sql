-- 0025 — Put SECURITY DEFINER back on the two functions 0024 replaced.
--
-- 0024 rewrote mfa_satisfied() and require_mfa() to add the freshness clock
-- and lost a word doing it. `create or replace function` replaces the whole
-- definition, security attribute included, and neither new body carried
-- `security definer` — so both silently became SECURITY INVOKER.
--
-- mfa_satisfied() reads auth.mfa_factors, which `authenticated` cannot select.
-- Every PostgREST request runs require_mfa() as its pre-request hook, so the
-- result was that every authenticated request failed with
--
--   ERROR: permission denied for table mfa_factors
--
-- and the app looped: sign in, TOTP, first data call throws, back to sign in.
-- It is not caught as an MFA error either, because 42501 from a *table* denial
-- carries none of the MFA detail lines the frontend classifies on.
--
-- The case expression does not save us here: mfa_satisfied() is a SQL function,
-- so the planner inlines it and is free to evaluate the auth.mfa_factors
-- sublink even on the aal2 branch that would never have reached it.
--
-- Bodies below are 0024's, unchanged apart from the restored attribute.

create or replace function mfa_satisfied() returns boolean
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
    -- Recent aal2. 'absent' — aal2 with no totp in `amr` — falls through to
    -- false on purpose: TOTP is the only factor this deployment enables, so
    -- that shape means something unexpected and the safe answer is to ask.
    when coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'aal', '') = 'aal2'
      then totp_freshness(3600) = 'fresh'
    else not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.status = 'verified'
    )
  end;
$$;

create or replace function require_mfa() returns void
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if mfa_satisfied() then return; end if;

  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'aal', '') = 'aal2' then
    raise insufficient_privilege
      using message = 'Your two-factor verification has expired.',
            detail  = 'MFA_STALE: this session verified an authenticator more than an hour ago. Enter a current code to continue.';
  end if;

  raise insufficient_privilege
    using message = 'Two-factor authentication is required for this session.',
          detail  = 'MFA_ABSENT: this session was established with a password only. Verify your authenticator app to continue.';
end;
$$;

grant execute on function mfa_satisfied()   to anon, authenticated, service_role;
grant execute on function require_mfa()     to authenticated, service_role;
