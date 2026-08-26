-- 0030 — create_first_hop_option() has never worked
-- ============================================================
-- category_first_hop_options has carried a `tag_id uuid` column (FK to
-- tags) since 0002. create_first_hop_option(), written in 0012, inserts
-- into a column called `resolve_tag` that has never existed on that table
-- — not a rename, just wrong from the start. It sat unnoticed because
-- nothing had tried to configure first-hop routing on a real category
-- until now. Replaced below to look the tag code up and insert the id it
-- resolves to, raising a clear error if the code doesn't match anything.
--
-- SECURITY DEFINER and set search_path = public repeated explicitly per
-- HANDOFF.md's `create or replace function` trap.

create or replace function create_first_hop_option(p_category_id uuid, p_label text, p_resolve_tag text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid;
  v_tag_id uuid;
begin
  perform assert_captain();

  select id into v_tag_id from tags where code = trim(p_resolve_tag);
  if v_tag_id is null then
    raise exception 'No tag with code %', trim(p_resolve_tag);
  end if;

  insert into category_first_hop_options (category_id, label, tag_id)
  values (p_category_id, trim(p_label), v_tag_id)
  returning id into v_id;
  return v_id;
end;
$$;
