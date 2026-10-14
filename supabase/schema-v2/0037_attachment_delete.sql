-- 0037 — let the uploader delete their own attachment
-- ============================================================
-- request_attachments and the attachments storage bucket have only ever
-- had INSERT/SELECT policies (0033/0034) — nobody could delete an
-- attachment at the database level even with a frontend button, since RLS
-- defaults to deny with no matching policy.
--
-- Scoped to the uploader only, not "anyone who can see the request" —
-- matching the comment already on attachments_write ("anyone who can see
-- the request may upload"; deleting someone else's upload is a different,
-- larger trust decision nobody asked for here). No ConfirmDestructive/TOTP
-- re-check: unlike deleting a routing option or revoking an invite, this
-- is recoverable (re-upload the file) and scoped to the uploader's own
-- data, so it doesn't need the heavier destructive-action machinery.
--
-- Order matters for the frontend: the storage policy below checks
-- request_attachments for a matching row, so the storage object must be
-- removed BEFORE the request_attachments row, not after — delete the row
-- first and the storage policy's own EXISTS check has nothing left to
-- match, and the real file in Garage is orphaned, unreachable but never
-- cleaned up.

create policy attachments_delete on request_attachments for delete
  to authenticated
  using (uploaded_by = auth.uid() and can_see_request(request_id) and mfa_satisfied());

-- Keyed against request_attachments.uploaded_by rather than
-- storage.objects' own owner/owner_id columns — those are storage-api's
-- own bookkeeping, unverified in this deployment, where
-- record_attachment() already writes a trustworthy uploaded_by on every
-- row. One source of truth for "who uploaded this," not two that could
-- disagree.
create policy attachment_objects_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'attachments'
    and exists (
      select 1 from request_attachments ra
      where ra.object_key = storage.objects.name
        and ra.uploaded_by = auth.uid()
    )
    and mfa_satisfied()
  );
