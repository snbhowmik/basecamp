-- 0034 — guard the storage-policy cast, and make record_attachment's claim true
-- ============================================================
-- Two follow-ups from review of 0033, before either could bite:
--
-- 1. attachment_objects_insert/_read cast (storage.foldername(name))[1] to
--    uuid unconditionally. Tested empirically against a live signatures-bucket
--    object with a non-uuid folder segment and Postgres short-circuited the
--    `bucket_id = 'attachments' and ...` correctly with no error — but that is
--    observed behaviour, not a documented guarantee, and this project has
--    already been bitten once by assuming a "can't be reached" branch is
--    actually unreached (HANDOFF §7, the SQL-inlining trap). A regex guard
--    costs nothing and removes the question.
--
-- 2. record_attachment()'s own comment claimed it records "what actually
--    landed" rather than trusting the client's claim about size or type —
--    untrue as written; it inserted p_file_name/p_mime_type/p_size_bytes
--    verbatim. Fixed to actually read them from storage.objects.metadata
--    (supabase-storage's own record of what it received), falling back to
--    the caller's values only if metadata is absent.

drop policy attachment_objects_insert on storage.objects;
create policy attachment_objects_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and name ~ '^[0-9a-f-]{36}/'
    and can_see_request((storage.foldername(name))[1]::uuid)
    and mfa_satisfied()
  );

drop policy attachment_objects_read on storage.objects;
create policy attachment_objects_read on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and name ~ '^[0-9a-f-]{36}/'
    and can_see_request((storage.foldername(name))[1]::uuid)
    and mfa_satisfied()
  );

create or replace function record_attachment(
  p_request_id uuid,
  p_object_key text,
  p_file_name  text,
  p_mime_type  text,
  p_size_bytes bigint
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id       uuid;
  v_metadata jsonb;
begin
  if not can_see_request(p_request_id) then
    raise exception 'No such request.';
  end if;
  if split_part(p_object_key, '/', 1) <> p_request_id::text then
    raise exception 'That object does not belong to this request.';
  end if;

  select metadata into v_metadata
  from storage.objects
  where bucket_id = 'attachments' and name = trim(p_object_key);

  if v_metadata is null then
    raise exception 'That file has not finished uploading.';
  end if;

  insert into request_attachments
    (request_id, uploaded_by, object_key, file_name, mime_type, size_bytes)
  values (
    p_request_id, auth.uid(), trim(p_object_key), trim(p_file_name),
    coalesce(v_metadata ->> 'mimetype', trim(p_mime_type)),
    coalesce((v_metadata ->> 'size')::bigint, p_size_bytes)
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function record_attachment(uuid, text, text, text, bigint) to authenticated;
