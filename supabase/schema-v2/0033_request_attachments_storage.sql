-- 0033 — request attachments in object storage
-- ============================================================
-- request_attachments (0002) and its RLS (0003, attachments_write/_read)
-- have existed since v2's first migration with no bucket, no storage
-- policy, and no upload path — the schema was ready, nothing above it was
-- built. Same shape as 0018 did for signatures; this is that file's
-- pattern, not a new one.
--
-- Unlike signatures, ownership isn't "does this belong to me" — it's "can
-- everyone who can see the request see the attachment", because a request
-- can carry several people's uploads (the requester, later a club admin).
-- The object path is attachments/<request_id>/<uuid>-<filename>, and both
-- storage policies resolve back to can_see_request() on that first segment,
-- the same function request_attachments' own table RLS already uses.
--
-- Recording the row is an RPC, not a direct insert, even though
-- attachments_write's WITH CHECK (uploaded_by = auth.uid() and
-- can_see_request(request_id)) would by itself be enough — consistent with
-- every other write path in this project (HANDOFF §6), and because
-- resolving file_name/mime_type/size_bytes from the just-uploaded object
-- keeps the client from asserting a size or type the object doesn't have.

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists attachment_objects_insert on storage.objects;
create policy attachment_objects_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and can_see_request((storage.foldername(name))[1]::uuid)
    and mfa_satisfied()
  );

drop policy if exists attachment_objects_read on storage.objects;
create policy attachment_objects_read on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and can_see_request((storage.foldername(name))[1]::uuid)
    and mfa_satisfied()
  );

-- No delete policy: nothing removes an attachment today, including the
-- purge job (SECURITY.md R-24, still unbuilt — HANDOFF §8).

create or replace function record_attachment(
  p_request_id uuid,
  p_object_key text,
  p_file_name  text,
  p_mime_type  text,
  p_size_bytes bigint
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not can_see_request(p_request_id) then
    raise exception 'No such request.';
  end if;
  if split_part(p_object_key, '/', 1) <> p_request_id::text then
    raise exception 'That object does not belong to this request.';
  end if;

  insert into request_attachments
    (request_id, uploaded_by, object_key, file_name, mime_type, size_bytes)
  values
    (p_request_id, auth.uid(), trim(p_object_key), trim(p_file_name), trim(p_mime_type), p_size_bytes)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function record_attachment(uuid, text, text, text, bigint) to authenticated;

notify pgrst, 'reload schema';
