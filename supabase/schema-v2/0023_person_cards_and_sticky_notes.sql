-- Basecamp v2 — the person card everyone can open, and the sticky note on it
-- ============================================================
--
-- Two changes that only make sense together.
--
-- 1. WIDENING TIER 1. PRD-V2 §9.1 gates the person card on can_see_request():
--    you may look somebody up if you already share a ticket with them. The
--    product decision has since changed — the org structure is meant to be
--    visible to everyone in the portal "so everyone knows everyone", and a
--    lookup is allowed for anyone registered and MFA-verified.
--
--    That is a real widening of a privacy line the PRD drew deliberately, so
--    it is recorded here rather than quietly applied: register number, FET ID,
--    email, department, batch and class become visible to every signed-in,
--    MFA-verified member of the organisation. The tech/non-tech counts are
--    kept because §9.1 lists them as Tier 1 and this change widens Tier 1's
--    audience rather than redefining its contents — but they are the one field
--    here that is activity data rather than directory data, and they are the
--    first thing to drop if that turns out to be too much.
--
--    Tier 2 is untouched. CGPA, proof and verification stay where §9.2 put
--    them: self, or staff who outrank you in your own subtree.
--
-- 2. THE STICKY NOTE. The people attached to a person by the shape of the org:
--    a student's mentor and HOD, without anybody typing either name in. It is
--    derived on read from role_assignments and never stored, so it cannot go
--    stale, cannot be forged, and follows a mentor changing section without a
--    migration or a backfill.
--
--    "Enabled" is not a separate flag. A level has sticky notes when the
--    captain has said which rungs should appear on them — configuring it IS
--    turning it on, and there is no second switch to leave inconsistent with
--    the rules behind it.

-- ── Sticky note configuration ─────────────────────────────────────────────

create table sticky_note_rules (
  -- Whose card carries the note (e.g. the Student rung).
  subject_level_id uuid not null references priority_levels(id) on delete cascade,
  -- Which rung is resolved onto it (e.g. Mentor, Head of Department).
  shown_level_id   uuid not null references priority_levels(id) on delete cascade,
  sort_order       integer not null default 0,
  primary key (subject_level_id, shown_level_id)
);

alter table sticky_note_rules enable row level security;
alter table sticky_note_rules force row level security;

-- Readable by anyone signed in: the note is drawn client-side from these
-- rules, and knowing that "students show mentor and HOD" leaks nothing.
create policy sticky_note_rules_read on sticky_note_rules
  for select to authenticated
  using (mfa_satisfied());

create policy sticky_note_rules_write on sticky_note_rules
  for all to authenticated
  using ((has_tag('admin') or can_bootstrap()) and mfa_satisfied())
  with check ((has_tag('admin') or can_bootstrap()) and mfa_satisfied());

-- Replace the whole rule set for one subject level in a single call. Passing
-- an empty array turns sticky notes off for that level, which is the same
-- operation as never having configured it — one code path, not two.
create function set_sticky_note_roles(
  p_subject_level_id uuid,
  p_shown_level_ids  uuid[]
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_captain();

  if p_subject_level_id = any(coalesce(p_shown_level_ids, '{}')) then
    raise exception 'A level cannot appear on its own sticky note.';
  end if;

  delete from sticky_note_rules where subject_level_id = p_subject_level_id;

  insert into sticky_note_rules (subject_level_id, shown_level_id, sort_order)
  select p_subject_level_id, id, ordinality
  from unnest(coalesce(p_shown_level_ids, '{}')) with ordinality as t(id, ordinality);
end;
$$;

-- ── The sticky note itself ────────────────────────────────────────────────
--
-- For each configured rung, the people at that rung whose scope actually
-- covers this person. An assignment scoped to a section matches only that
-- section; one scoped to an org unit matches anything beneath it; one with no
-- scope at all (the captain) covers everybody. That last case is why the note
-- is worth deriving rather than storing — it is the same relationship
-- can_see_request() already walks, read from one direction instead of the
-- other.

create function get_sticky_note(p_user_id uuid)
returns table (
  level_id   uuid,
  level_name text,
  level_rank integer,
  user_id    uuid,
  full_name  text,
  email      text,
  org_unit_name text,
  section_name  text
)
language sql stable security definer set search_path = public as $$
  with subject as (
    select mp.user_id, mp.org_unit_id, mp.section_id
    from member_profiles mp
    where mp.user_id = p_user_id
  ),
  -- The rungs this person's own level is configured to show.
  rules as (
    select snr.shown_level_id, snr.sort_order
    from sticky_note_rules snr
    where snr.subject_level_id in (
      select ra.level_id from role_assignments ra
      where ra.user_id = p_user_id
        and assignment_is_current(ra.valid_from, ra.valid_until)
    )
  )
  select pl.id, pl.name, pl.rank, p.id, p.full_name, p.email, ou.name, s.name
  from rules r
  join priority_levels pl on pl.id = r.shown_level_id
  join role_assignments ra on ra.level_id = r.shown_level_id
    and assignment_is_current(ra.valid_from, ra.valid_until)
  join profiles p on p.id = ra.user_id and p.is_active
  cross join subject sub
  left join org_units ou on ou.id = ra.org_unit_id
  left join sections  s  on s.id  = ra.section_id
  where auth.uid() is not null
    and mfa_satisfied()
    and (
      case
        when ra.section_id is not null then ra.section_id = sub.section_id
        when ra.org_unit_id is not null then
          sub.org_unit_id is not null and in_org_subtree(ra.org_unit_id, sub.org_unit_id)
        -- No scope: the rung covers the whole organisation.
        else true
      end
    )
  order by r.sort_order, pl.rank, p.full_name;
$$;

-- ── Tier 1, widened ───────────────────────────────────────────────────────

drop function if exists get_member_card(uuid);

create function get_member_card(p_user_id uuid)
returns table (
  user_id        uuid,
  full_name      text,
  email          text,
  member_type    text,
  reg_no         text,
  fet_id         text,
  level_name     text,
  org_unit_name  text,
  batch_name     text,
  section_name   text,
  tech_count     bigint,
  non_tech_count bigint
)
language sql stable security definer set search_path = public as $$
  select
    p.id, p.full_name, p.email, mp.member_type, mp.reg_no, mp.fet_id,
    held.level_name, ou.name, b.name, s.name,
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
  left join lateral (
    select pl.name as level_name
    from role_assignments ra
    join priority_levels pl on pl.id = ra.level_id
    where ra.user_id = p.id and assignment_is_current(ra.valid_from, ra.valid_until)
    order by ra.is_primary desc, pl.rank
    limit 1
  ) held on true
  -- The whole gate. Signed in, MFA-verified, and the person is still active —
  -- a deactivated account is not part of the organisation chart.
  where p.id = p_user_id
    and p.is_active
    and auth.uid() is not null
    and mfa_satisfied();
$$;

-- SECURITY DEFINER functions bypass RLS, so the EXECUTE grant is load-bearing
-- rather than decorative. 0021 has the history of what happens when it isn't
-- set deliberately.
revoke execute on function get_member_card(uuid)                 from public, anon;
revoke execute on function get_sticky_note(uuid)                 from public, anon;
revoke execute on function set_sticky_note_roles(uuid, uuid[])   from public, anon;

grant execute on function get_member_card(uuid)               to authenticated;
grant execute on function get_sticky_note(uuid)               to authenticated;
grant execute on function set_sticky_note_roles(uuid, uuid[]) to authenticated;
