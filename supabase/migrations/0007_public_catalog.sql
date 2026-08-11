-- Basecamp v1.0.0 — Public catalog reads for self-registration
-- ============================================================
-- 0003 gated departments/classes reads behind `auth.uid() is not null`,
-- which was right at the time: the only readers were signed-in users
-- filling in an invite form. 0005 then added public student
-- self-registration, where the registrant picks their own department and
-- batch *before* they have an account — and that page silently got back
-- zero rows. No error, no failed request: RLS filtering just returns an
-- empty set, so the dropdowns rendered blank and looked like missing data.
--
-- Rather than open the whole table to `anon`, expose only what the signup
-- form actually renders. `departments.tag_id` / `classes.tag_id` stay
-- invisible — those are the handles is_hod_of()/is_mentor_of() resolve
-- scope through, and an unauthenticated visitor has no business seeing the
-- permission system's wiring even if the UUIDs alone grant nothing.
--
-- Department and batch NAMES are not sensitive (they're on the public
-- prospectus); the point is minimal exposure, not secrecy.

create or replace function list_public_departments()
returns table (id uuid, name text)
language sql security definer stable set search_path = public as $$
  select d.id, d.name
  from departments d
  where d.is_active
  order by d.name;
$$;

create or replace function list_public_batches(p_department_id uuid)
returns table (id uuid, name text)
language sql security definer stable set search_path = public as $$
  select c.id, c.name
  from classes c
  where c.department_id = p_department_id and c.is_active
  order by c.year desc, c.name;
$$;

grant execute on function list_public_departments()      to anon, authenticated;
grant execute on function list_public_batches(uuid)      to anon, authenticated;
