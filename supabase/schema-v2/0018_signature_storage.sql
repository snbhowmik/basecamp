-- Basecamp v2 — signature assets in object storage
-- ============================================================
-- PRD.md §14.1: a staff member registers a signature once — drawn or
-- uploaded, cleaned to a transparent stamp — and it is reused on every
-- document from then on. No re-signing per document.
--
-- The image lives in object storage (Garage, via storage-api); only the
-- object key lives in the database, in signature_assets. That table already
-- existed and was unused; this file gives it a bucket, an access rule and a
-- write path.

insert into storage.buckets (id, name, public)
values ('signatures', 'signatures', false)
on conflict (id) do nothing;

-- ============================================================
-- can_read_signature() — who may fetch someone else's stamp
-- ============================================================
-- Not "anyone signed in". A signature image is the raw material for forging a
-- document, so it is not browsable: you may fetch a stamp only if you can see
-- a request that person actually signed. In practice that is the student
-- downloading their own approved OD, and the staff in its chain.
--
-- Forging is separately defeated by §14.4 — a fabricated PDF carries no
-- reference code that resolves — but "the forgery is detectable" is a weaker
-- position than "the ingredients were never handed out".
create or replace function can_read_signature(p_object_key text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from signature_assets sa
    where sa.object_key = p_object_key
      and (
        sa.user_id = auth.uid()
        or exists (
          select 1 from signatures sg
          where sg.signer_id = sa.user_id
            and can_see_request(sg.request_id)
        )
      )
  );
$$;

grant execute on function can_read_signature(text) to authenticated;

-- ============================================================
-- Storage policies
-- ============================================================
-- storage.objects is not in the `public` schema, so 0016's policy sweep did
-- not reach it. mfa_satisfied() is applied here by hand for the same reason it
-- was applied there: a password-only session must not be able to register a
-- signature that will be stamped onto official documents.
--
-- The owning user is the first path segment: signatures/<user_id>/<file>.
-- That is what ties an uploaded object back to an account without trusting
-- anything the client sends.
drop policy if exists signature_objects_insert on storage.objects;
create policy signature_objects_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'signatures'
    and (storage.foldername(name))[1] = auth.uid()::text
    and mfa_satisfied()
  );

drop policy if exists signature_objects_read on storage.objects;
create policy signature_objects_read on storage.objects for select
  to authenticated
  using (bucket_id = 'signatures' and mfa_satisfied() and can_read_signature(name));

-- Replacing a signature is an insert plus a deactivation, never an in-place
-- overwrite: a document generated earlier still references the old key, and
-- §14.4 promises it regenerates identically.
drop policy if exists signature_objects_delete on storage.objects;
create policy signature_objects_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'signatures'
    and (storage.foldername(name))[1] = auth.uid()::text
    and mfa_satisfied()
  );

-- ============================================================
-- set_my_signature() — register the uploaded object
-- ============================================================
-- One active signature per user, enforced by the existing partial unique
-- index. The previous one is deactivated rather than deleted so that
-- documents already stamped with it keep resolving.
create or replace function set_my_signature(p_object_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if not has_mfa() then
    raise exception 'Two-factor authentication is required to register a signature.';
  end if;
  if coalesce(trim(p_object_key), '') = '' then
    raise exception 'No signature image was uploaded.';
  end if;
  -- The object key must sit under the caller's own folder. Without this a
  -- user could point their signature row at somebody else's stamp and have it
  -- rendered under their own name.
  if split_part(p_object_key, '/', 1) <> auth.uid()::text then
    raise exception 'That signature does not belong to this account.';
  end if;

  update signature_assets set is_active = false
  where user_id = auth.uid() and is_active;

  insert into signature_assets (user_id, object_key, is_active)
  values (auth.uid(), trim(p_object_key), true)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function set_my_signature(text) to authenticated;

-- ============================================================
-- my_signature() — what the account page shows
-- ============================================================
create or replace function my_signature()
returns text language sql security definer stable set search_path = public as $$
  select object_key from signature_assets
  where user_id = auth.uid() and is_active;
$$;

grant execute on function my_signature() to authenticated;

notify pgrst, 'reload schema';
