-- Basecamp — Invite email delivery
-- ============================================================
-- Until now an invite produced a /invite/<token> URL that the inviter had
-- to copy and send by hand (NOTE.md, "no email is sent automatically yet").
-- This migration adds the delivery bookkeeping and a narrowly-scoped role
-- for the `mailer` service that does the sending.
--
-- WHY THIS IS NOT A REVERSAL OF THE "NO BACKEND" DECISION (NOTE.md
-- 2026-08-10): that decision rejected a server-side component because
-- *creating accounts* needs `service_role`, which bypasses RLS entirely and
-- must never leave the server. Sending a notification email needs neither
-- service_role nor the GoTrue admin API — only SMTP credentials and read
-- access to one table. The mailer below cannot create a user, cannot read a
-- request, cannot bypass RLS, and is not reachable from the internet. It is
-- a background worker, not a BFF: nothing in the client's request path goes
-- through it, so the risk ARCH.md §2 was avoiding doesn't reappear.
--
-- The invite mechanism itself is unchanged. invite_token and
-- get_invite_by_token() (0005) already work; this only automates delivery
-- of the link that already existed.

-- ============================================================
-- Delivery bookkeeping
-- ============================================================
alter table pending_assignments
  add column invite_email_sent_at    timestamptz,
  add column invite_email_claimed_at timestamptz,
  add column invite_email_attempts   int not null default 0,
  add column invite_email_error      text;

-- Partial index over exactly the rows the mailer polls for. Keeps the poll
-- O(pending) rather than O(all invites ever created) — this table only ever
-- grows, and consumed invites stay in it as an audit record.
create index pending_assignments_email_queue
  on pending_assignments (created_at)
  where consumed_at is null
    and invite_email_sent_at is null
    and invite_email_attempts < 5;

-- ============================================================
-- The mailer's database role
-- ============================================================
-- Created NOLOGIN here on purpose: a password in a migration is a password
-- in git. scripts/bootstrap-db-roles.sh sets the password and grants LOGIN
-- from .env, the same way it does for authenticator/supabase_auth_admin.
-- Until that runs, this role exists but cannot connect.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'basecamp_mailer') then
    create role basecamp_mailer nologin;
  end if;
end
$$;

grant usage on schema public to basecamp_mailer;

-- ============================================================
-- claim_invite_emails() — the mailer's only read path
-- ============================================================
-- SECURITY DEFINER because pending_assignments has FORCE ROW LEVEL SECURITY
-- and basecamp_mailer holds no policy on it — deliberately. Rather than
-- granting the role table access and writing a policy that would also widen
-- what a compromised mailer could read, the role gets exactly three
-- functions and no table privileges at all.
--
-- Claim-then-send (rather than send-then-mark) so a mailer that dies
-- mid-send doesn't leave a row that gets re-sent on every subsequent poll.
-- A claim older than 5 minutes is treated as abandoned and retried, which
-- is why claimed_at is a timestamp and not a boolean.
--
-- FOR UPDATE SKIP LOCKED so two mailer replicas can never claim the same
-- row. There is only one replica today; this costs nothing and removes a
-- foot-gun if that ever changes.
create or replace function claim_invite_emails(p_limit int default 20)
returns table (
  id              uuid,
  email           text,
  invite_token    uuid,
  level_name      text,
  department_name text,
  invited_by_name text
)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with claimed as (
    select pa.id
    from pending_assignments pa
    where pa.consumed_at is null
      and pa.invite_email_sent_at is null
      and pa.invite_email_attempts < 5
      and (pa.invite_email_claimed_at is null
           or pa.invite_email_claimed_at < now() - interval '5 minutes')
    order by pa.created_at
    limit p_limit
    for update skip locked
  )
  update pending_assignments pa
  set invite_email_claimed_at = now(),
      invite_email_attempts   = pa.invite_email_attempts + 1
  from claimed c
  where pa.id = c.id
  returning
    pa.id,
    pa.email,
    pa.invite_token,
    (select pl.name from priority_levels pl where pl.id = pa.level_id),
    (select d.name  from departments    d  where d.id = pa.department_id),
    (select p.full_name from profiles   p  where p.id = pa.invited_by);
end;
$$;

create or replace function mark_invite_email_sent(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update pending_assignments
  set invite_email_sent_at = now(),
      invite_email_error   = null
  where id = p_id;
$$;

create or replace function mark_invite_email_failed(p_id uuid, p_error text)
returns void language sql security definer set search_path = public as $$
  update pending_assignments
  set invite_email_error = left(p_error, 500)
  where id = p_id;
$$;

-- Only the mailer. Not `authenticated`, not `anon` — claim_invite_emails()
-- returns email addresses and live tokens, which is exactly the payload an
-- attacker would want in order to hijack a pending staff invite.
revoke execute on function claim_invite_emails(int)          from public;
revoke execute on function mark_invite_email_sent(uuid)      from public;
revoke execute on function mark_invite_email_failed(uuid, text) from public;

grant execute on function claim_invite_emails(int)             to basecamp_mailer;
grant execute on function mark_invite_email_sent(uuid)         to basecamp_mailer;
grant execute on function mark_invite_email_failed(uuid, text) to basecamp_mailer;

-- ============================================================
-- Resend support — lets the inviter re-trigger delivery from the UI by
-- clearing the sent stamp. Authorization is the existing invite ownership
-- rule, re-checked here because SECURITY DEFINER bypasses the RLS that
-- would otherwise enforce it (same pattern as create_and_submit_request in
-- 0006 — see NOTE.md 2026-08-11).
-- ============================================================
create or replace function resend_invite_email(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from pending_assignments
    where id = p_id
      and consumed_at is null
      and (invited_by = auth.uid() or has_tag('admin'))
  ) then
    raise exception 'Not allowed to resend this invite.';
  end if;

  update pending_assignments
  set invite_email_sent_at    = null,
      invite_email_claimed_at = null,
      invite_email_attempts   = 0,
      invite_email_error      = null
  where id = p_id;
end;
$$;

grant execute on function resend_invite_email(uuid) to authenticated;
