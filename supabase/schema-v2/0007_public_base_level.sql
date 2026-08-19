-- ============================================================
-- Base level lookup for public self-registration
-- ============================================================
-- pa_self_register lets an anonymous student create their own invite row, but
-- pins level_id to the base level. The registration form therefore has to send
-- that id -- and could not discover it, because priority_levels_read is granted
-- to `authenticated` only. Anonymous callers got an empty list and the form
-- told them "No priority levels configured yet -- contact your administrator",
-- which sent people to an administrator who had configured everything
-- correctly.
--
-- Same shape as list_public_org_units()/list_public_batches(): a SECURITY
-- DEFINER function exposing exactly the one value the public form needs, rather
-- than opening the table to anon.
create or replace function public_base_level()
returns uuid language sql security definer stable set search_path = public as $$
  select id from priority_levels where is_base and is_active limit 1;
$$;

grant execute on function public_base_level() to anon, authenticated;
