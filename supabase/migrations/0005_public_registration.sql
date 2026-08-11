-- Basecamp v1.0.0 — Public Student Self-Registration + Staff Invite Links
-- ============================================================
-- Two signup paths, per README.md's V2 design notes:
--   1. Public self-registration — open to anyone on an allowed domain,
--      creates a STUDENT (base-level) account only. The registrant picks
--      their own department + batch in the signup form.
--   2. Staff/faculty — invite-only, via a dedicated token link
--      (this migration adds `invite_token`), never through the public form.
--
-- Both reuse the exact same pending_assignments + apply_pending_assignment()
-- machinery from 0004 — a self-registering student creates their OWN
-- pending_assignments row (unauthenticated, hence invited_by must become
-- nullable) immediately before calling signUp(), so by the time
-- check_allowed_domain() runs on the auth.users insert, an invite-shaped
-- row already exists, exactly like an admin-created invite would. No
-- change needed to check_allowed_domain() itself.

-- ============================================================
-- invited_by nullable — null means "self-registered", not invited by anyone
-- ============================================================
alter table pending_assignments alter column invited_by drop not null;

-- ============================================================
-- Email uniqueness: only ONE *open* (unconsumed) invite per email at a
-- time, not a permanent lifetime lock. The blanket unique constraint from
-- 0004 would otherwise make it impossible to ever re-invite someone whose
-- earlier invite expired or was revoked-and-recreated.
-- ============================================================
alter table pending_assignments drop constraint pending_assignments_email_key;
drop index if exists pending_assignments_open;
create unique index pending_assignments_open_email on pending_assignments (lower(email)) where consumed_at is null;

-- ============================================================
-- invite_token — the staff invite link is /invite/<token>, looked up via
-- get_invite_by_token() below rather than direct table access (keeps the
-- rest of the row, and every OTHER pending invite, invisible to an
-- unauthenticated visitor).
-- ============================================================
alter table pending_assignments add column invite_token uuid not null default gen_random_uuid() unique;

-- ============================================================
-- Self-registration — anyone (including anon) may create a pending
-- assignment for themselves, but only base-level, department-scoped, no
-- staff tags. This is intentionally NOT identity-checked (can't be, the
-- caller isn't authenticated yet) — the real identity check is still
-- owning the inbox at email confirmation, same trust model open signup
-- always had. Known low-severity gap: someone could pre-create a bogus
-- open row for an email they don't own, colliding with
-- pending_assignments_open_email and blocking that person's real
-- self-registration until an admin deletes it. Acceptable for a
-- domain-restricted, self-hosted, single-institution deployment; revisit
-- (rate limiting, a captcha) if it's ever actually abused. See NOTE.md.
-- ============================================================
create policy pending_assignments_self_register on pending_assignments for insert
with check (
  invited_by is null
  and department_id is not null
  and coalesce(array_length(tag_codes, 1), 0) = 0
  and level_id = (select id from priority_levels order by rank desc limit 1)
);

-- ============================================================
-- get_invite_by_token() — what the /invite/<token> page calls, anon
-- included. Returns only the single matching unconsumed row's
-- display-relevant fields, never the table itself — an unauthenticated
-- visitor with a token can see who invited them and to what, nothing else.
-- ============================================================
create or replace function get_invite_by_token(p_token uuid)
returns table (
  email text,
  level_name text,
  department_name text,
  invited_by_name text
)
language sql security definer stable set search_path = public as $$
  select pa.email, pl.name, d.name, p.full_name
  from pending_assignments pa
  join priority_levels pl on pl.id = pa.level_id
  left join departments d on d.id = pa.department_id
  left join profiles p on p.id = pa.invited_by
  where pa.invite_token = p_token and pa.consumed_at is null;
$$;

grant execute on function get_invite_by_token(uuid) to anon, authenticated;
