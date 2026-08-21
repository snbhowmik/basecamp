-- Basecamp v2 — search_people() gains the facets the org board needs
-- ============================================================
-- The board's search has two shapes and this function has to serve both:
--
--   "type a register number"  — a text lookup, ranked, small result
--   "Computer Science → III-B" — a browse with no text at all
--
-- So p_query becomes optional. An empty query is not "match nothing", it is
-- "no text filter" — the facets alone decide the set. That is what makes
-- department-then-class work without a name.
--
-- Because a browse can be large, the function pages (p_offset) and returns
-- total_count as a window aggregate, so the caller can say "37 of 412" without
-- a second round trip.
--
-- The level facet is "holds a current assignment at this rung", not "is tagged
-- with this role" — tags label what someone IS in the org, assignments record
-- what they currently HOLD, and only the latter expires. assignment_is_current()
-- is the existing helper for exactly this and is reused rather than re-derived.
--
-- The auth guard from 0021 is carried forward deliberately. This is a
-- drop-and-recreate (the parameter list changes, so create-or-replace would
-- leave the old four-argument overload resolvable), and a drop takes the
-- grants with it — so both the guard and the grants are re-stated below.

drop function if exists search_people(text, text, uuid, integer);

create function search_people(
  p_query       text    default '',
  p_member_type text    default null,
  p_org_unit_id uuid    default null,
  p_section_id  uuid    default null,
  p_batch_id    uuid    default null,
  p_level_id    uuid    default null,
  p_limit       integer default 25,
  p_offset      integer default 0
)
returns table (
  user_id       uuid,
  full_name     text,
  email         text,
  reg_no        text,
  fet_id        text,
  member_type   text,
  org_unit_name text,
  batch_name    text,
  section_name  text,
  level_name    text,
  rank_score    integer,
  total_count   bigint
)
language sql stable security definer set search_path = public as $$
  with q as (select nullif(trim(coalesce(p_query, '')), '') as term)
  select
    p.id, p.full_name, p.email, mp.reg_no, mp.fet_id, mp.member_type,
    ou.name, b.name, s.name, held.level_name,
    case
      when q.term is null then 9
      when upper(mp.reg_no) = upper(q.term) or upper(mp.fet_id) = upper(q.term) then 0
      when upper(mp.reg_no) like upper(q.term) || '%'
        or upper(mp.fet_id) like upper(q.term) || '%' then 1
      when p.full_name ilike q.term || '%' then 2
      else 3
    end as rank_score,
    count(*) over () as total_count
  from profiles p
  cross join q
  left join member_profiles mp on mp.user_id = p.id
  left join org_units ou on ou.id = mp.org_unit_id
  left join batches   b  on b.id  = mp.batch_id
  left join sections  s  on s.id  = mp.section_id
  -- The rung they stand on. is_primary first so somebody holding several
  -- roles is labelled by the one they'd introduce themselves with.
  left join lateral (
    select pl.name as level_name
    from role_assignments ra
    join priority_levels pl on pl.id = ra.level_id
    where ra.user_id = p.id and assignment_is_current(ra.valid_from, ra.valid_until)
    order by ra.is_primary desc, pl.rank
    limit 1
  ) held on true
  where auth.uid() is not null
    and mfa_satisfied()
    and p.is_active
    and (p_member_type is null or mp.member_type = p_member_type)
    and (p_org_unit_id is null or (mp.org_unit_id is not null and in_org_subtree(p_org_unit_id, mp.org_unit_id)))
    and (p_batch_id   is null or mp.batch_id   = p_batch_id)
    and (p_section_id is null or mp.section_id = p_section_id)
    and (p_level_id   is null or exists (
      select 1 from role_assignments ra
      where ra.user_id = p.id
        and ra.level_id = p_level_id
        and assignment_is_current(ra.valid_from, ra.valid_until)
    ))
    and (
      q.term is null
      or upper(mp.reg_no) like upper(q.term) || '%'
      or upper(mp.fet_id) like upper(q.term) || '%'
      or p.full_name ilike '%' || q.term || '%'
      or p.email ilike q.term || '%'
    )
  -- A browse has no meaningful ranking, so it falls back to register-number
  -- order — the order a register is actually kept in.
  order by rank_score, mp.reg_no nulls last, p.full_name
  limit least(coalesce(p_limit, 25), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke execute on function search_people(text, text, uuid, uuid, uuid, uuid, integer, integer) from public, anon;
grant  execute on function search_people(text, text, uuid, uuid, uuid, uuid, integer, integer) to authenticated;
