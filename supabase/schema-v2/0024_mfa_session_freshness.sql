-- 0024 — Make the MFA assertion expire, not just the access token.
--
-- GOTRUE_JWT_EXP is 3600, so an access token lives an hour. That was never a
-- bound on *MFA*: GoTrue carries the aal2 claim across every refresh-token
-- rotation, and mfa_satisfied() accepted a bare aal2 with no age test. A live
-- session observed on 2026-08-24 carried iat 1787521980 against a totp `amr`
-- timestamp of 1787216877 — the authenticator had been verified 85 hours
-- earlier and the session was still fully privileged.
--
-- So: aal2 now has to be *recent* aal2. totp_freshness() already reads the
-- `amr` timestamp for the sensitive-action gate; this reuses it at session
-- level with a much longer clock.
--
-- Two clocks, deliberately different, and this changes only the first:
--   session level  — 3600s, here. Re-enter a code roughly once an hour.
--   sensitive act  — 300s, assert_fresh_totp(). Countersigning, tag edits and
--                    the other step-up calls keep their five minutes.
--
-- What does NOT change: a user with no verified factor is still satisfied.
-- MFA remains opt-in by enrolment, and RLS still confines such an account.
-- Whether students should be allowed to stay in that state is a policy
-- question, not a schema one — see HANDOFF.md.

create or replace function mfa_satisfied() returns boolean
language sql
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

-- The frontend has to tell "you never verified" from "your hour is up" to know
-- whether to send somebody to full sign-in or just ask for a code. Same
-- SQLSTATE either way; the detail line is what carries the difference.
create or replace function require_mfa() returns void
language plpgsql
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

-- create or replace keeps existing grants, and mfa_satisfied() is named in RLS
-- policies that anon evaluates, so its EXECUTE must stay where it is. Restated
-- rather than assumed: a policy whose helper the caller cannot execute fails
-- closed for everybody, including the invite and registration paths.
grant execute on function mfa_satisfied()   to anon, authenticated, service_role;
grant execute on function totp_freshness(integer) to anon, authenticated, service_role;
grant execute on function require_mfa()     to authenticated, service_role;
