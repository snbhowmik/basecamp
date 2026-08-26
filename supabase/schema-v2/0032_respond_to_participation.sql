-- 0032 — respond_to_participation(): accept/decline through an RPC, not a
-- direct table write
-- ============================================================
-- `participants_update` (0003) has no WITH CHECK clause — it constrains
-- which row a participant may update, not which columns. request_participants
-- also carries parent_consent_verified, parent_consent_verified_by, is_leader
-- and the snapshot_* fields, and 0002's own comment says parent consent is
-- the mentor's to fill in by phone, never the student's to self-certify. A
-- direct .update() from the frontend, scoped in the client to only
-- acceptance_status/accepted_at, does not stop a raw PATCH to the same row
-- from touching any of those — the database is the only real boundary
-- (HANDOFF §6: RLS is the authorization boundary, never a frontend check).
--
-- This RPC is that boundary: it writes exactly two columns, and stamps
-- accepted_at server-side instead of trusting the browser's clock.

create or replace function respond_to_participation(p_participant_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update request_participants
  set acceptance_status = case when p_accept then 'accepted' else 'declined' end,
      accepted_at = case when p_accept then now() else null end
  where id = p_participant_id and member_id = auth.uid();

  if not found then
    raise exception 'That is not your place on this request.';
  end if;
end;
$$;

grant execute on function respond_to_participation(uuid, boolean) to authenticated;

-- The direct-write path this RPC replaces. member_id = auth.uid() stays (a
-- participant must still be able to read their own row through can_see_request,
-- and 0003's read policy already covers that) — only the ability to update by
-- being the participant is removed here; the holder and admin arms of the
-- original policy are re-created below so a mentor recording parent consent,
-- or the captain fixing a mistake, is unaffected.
drop policy participants_update on request_participants;

create policy participants_update on request_participants for update
  to authenticated using (
    (
      exists (select 1 from requests r where r.id = request_id and r.current_holder = auth.uid())
      or has_tag('admin')
    ) and mfa_satisfied()
  );
