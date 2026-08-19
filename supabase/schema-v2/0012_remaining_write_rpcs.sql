-- ============================================================
-- The rest of the write path, as functions
-- ============================================================
-- Completes the move off raw table writes from the browser. Reads stay as
-- RLS-filtered selects; every mutation now names an intent.
--
-- Each of these re-checks its own rule, because SECURITY DEFINER bypasses the
-- policy that used to be the only thing standing behind the equivalent insert.

-- --- own profile -------------------------------------------------------
create or replace function update_own_profile(p_full_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Name is required.';
  end if;
  update profiles set full_name = trim(p_full_name) where id = auth.uid();
end;
$$;

-- --- invites -----------------------------------------------------------
create or replace function create_invite(
  p_email       text,
  p_level_id    uuid,
  p_tag_codes   text[],
  p_member_type text,
  p_role_kind   text,
  p_org_unit_id uuid default null,
  p_batch_id    uuid default null,
  p_section_id  uuid default null,
  p_reg_no      text default null,
  p_fet_id      text default null
)
returns pending_assignments language plpgsql security definer set search_path = public as $$
declare v_row pending_assignments;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  -- The same predicate the RLS policy used. Stated once, here, now that this
  -- is the only way in.
  if not can_invite(p_level_id, p_org_unit_id) then
    raise exception 'You cannot invite someone at that level in that part of the organisation.';
  end if;
  if 'admin' = any(coalesce(p_tag_codes, array[]::text[])) then
    raise exception 'The captain tag cannot be granted through an invite.';
  end if;

  insert into pending_assignments (
    email, level_id, tag_codes, member_type, role_kind,
    org_unit_id, batch_id, section_id, reg_no, fet_id, invited_by
  ) values (
    lower(trim(p_email)), p_level_id, coalesce(p_tag_codes, array[]::text[]),
    p_member_type, coalesce(p_role_kind, 'academic'),
    p_org_unit_id, p_batch_id, p_section_id,
    nullif(trim(coalesce(p_reg_no, '')), ''), nullif(trim(coalesce(p_fet_id, '')), ''),
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Withdrawing an unused invite is a deletion, so it takes a fresh code like
-- any other. Staff may revoke what they issued; the captain may revoke any.
create or replace function revoke_invite(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from pending_assignments
    where id = p_id and (invited_by = auth.uid() or has_tag('admin'))
  ) then
    raise exception 'That invite is not yours to revoke.';
  end if;
  if not recently_verified_totp() then
    raise exception 'Confirm with your authenticator before revoking an invite.';
  end if;
  delete from pending_assignments where id = p_id and consumed_at is null;
end;
$$;

-- Public self-registration. Runs for callers with no session at all, so it
-- restates every constraint the pa_self_register policy carried rather than
-- trusting the caller for any of it: base level, student, no tags, no
-- inviter, and a register number that matches the batch it claims.
create or replace function self_register(
  p_email       text,
  p_org_unit_id uuid,
  p_batch_id    uuid,
  p_section_id  uuid,
  p_reg_no      text
)
returns void language plpgsql security definer set search_path = public as $$
declare v_base uuid;
begin
  select id into v_base from priority_levels where is_base and is_active limit 1;
  if v_base is null then
    raise exception 'No student level has been set up yet.';
  end if;
  if p_org_unit_id is null then
    raise exception 'Choose a programme.';
  end if;
  if coalesce(trim(p_reg_no), '') = '' then
    raise exception 'Registration number is required.';
  end if;
  if not reg_no_matches_batch(trim(p_reg_no), p_batch_id) then
    raise exception 'That registration number does not match the batch you selected.';
  end if;

  insert into pending_assignments (
    email, level_id, tag_codes, member_type, role_kind,
    org_unit_id, batch_id, section_id, reg_no, invited_by
  ) values (
    lower(trim(p_email)), v_base, array[]::text[], 'student', 'academic',
    p_org_unit_id, p_batch_id, p_section_id, trim(p_reg_no), null
  );
end;
$$;

-- --- catalog -----------------------------------------------------------
create or replace function create_request_type(p_code text, p_name text, p_decision_mode text default 'approval')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform assert_captain();
  insert into request_types (code, name, decision_mode)
  values (lower(trim(p_code)), trim(p_name), p_decision_mode::decision_mode)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function create_category(
  p_request_type_id uuid, p_parent_id uuid, p_name text,
  p_classification text default null, p_retain boolean default false
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform assert_captain();
  insert into request_categories (request_type_id, parent_id, name, classification, retain_attachments_after_close)
  values (p_request_type_id, p_parent_id, trim(p_name),
          nullif(trim(coalesce(p_classification, '')), ''), coalesce(p_retain, false))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function create_first_hop_option(p_category_id uuid, p_label text, p_resolve_tag text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform assert_captain();
  insert into category_first_hop_options (category_id, label, resolve_tag)
  values (p_category_id, trim(p_label), trim(p_resolve_tag))
  returning id into v_id;
  return v_id;
end;
$$;

-- --- request content ---------------------------------------------------
create or replace function save_field_values(p_request_id uuid, p_values jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_item jsonb;
begin
  if not exists (select 1 from requests where id = p_request_id and requested_by = auth.uid()) then
    raise exception 'That request is not yours.';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_values, '[]'::jsonb)) loop
    if v_item -> 'value' is not null and v_item ->> 'value' <> '' then
      insert into request_field_values (request_id, definition_id, value)
      values (p_request_id, (v_item ->> 'definition_id')::uuid, v_item -> 'value');
    end if;
  end loop;
end;
$$;

create or replace function add_comment(p_request_id uuid, p_body text, p_visibility text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_see_request(p_request_id) then
    raise exception 'You cannot comment on that request.';
  end if;
  if p_visibility not in ('public', 'internal') then
    raise exception 'Unknown comment visibility.';
  end if;
  -- The lowest level never authors internal notes. The trigger enforces this
  -- too; saying it here turns a constraint violation into a sentence.
  if p_visibility = 'internal' and is_lowest_level() then
    raise exception 'Internal notes are staff-only.';
  end if;
  insert into request_comments (request_id, author_id, visibility, body)
  values (p_request_id, auth.uid(), p_visibility, p_body);
end;
$$;

-- --- domains -----------------------------------------------------------
-- Allowed during the bootstrap window as well as afterwards: the wizard adds
-- the captain's own domain before any admin tag exists.
create or replace function add_allowed_domains(p_domains text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (can_bootstrap() or (has_tag('admin') and has_mfa())) then
    raise exception 'Only the captain can change allowed domains.';
  end if;
  insert into allowed_login_domains (domain, is_active)
  select lower(trim(d)), true
  from unnest(coalesce(p_domains, array[]::text[])) as d
  where trim(coalesce(d, '')) <> ''
  on conflict (domain) do nothing;
end;
$$;

grant execute on function update_own_profile(text) to authenticated;
grant execute on function create_invite(text, uuid, text[], text, text, uuid, uuid, uuid, text, text) to authenticated;
grant execute on function revoke_invite(uuid) to authenticated;
grant execute on function self_register(text, uuid, uuid, uuid, text) to anon, authenticated;
grant execute on function create_request_type(text, text, text) to authenticated;
grant execute on function create_category(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function create_first_hop_option(uuid, text, text) to authenticated;
grant execute on function save_field_values(uuid, jsonb) to authenticated;
grant execute on function add_comment(uuid, text, text) to authenticated;
grant execute on function add_allowed_domains(text[]) to anon, authenticated;
