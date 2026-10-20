-- ============================================================
-- Lock the 0042/0044 RPCs down to signed-in callers, and close an anon hole
-- ============================================================
-- Two problems, both found in review.
--
-- 1. delete_own_request() guarded with `r.requested_by <> auth.uid()`. For an
--    anonymous caller auth.uid() is NULL, the comparison is NULL, the raise is
--    skipped, and the withdraw runs. Same shape as the hole 0042 fixed in
--    decide_request. has_mfa()/mfa_satisfied() is TRUE for anon (HANDOFF §7), so
--    it is no backstop. Request UUIDs travel in ?open=<id> links, so this is
--    reachable. Fixed with an explicit auth.uid() null check + `is distinct from`.
--
-- 2. A new public function here is EXECUTABLE BY anon by default — the exact
--    reason 0021 exists. All six functions added in 0042/0044 came back
--    anon-executable. They are revoked from public/anon and left to
--    authenticated, as 0021 does.

create or replace function delete_own_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r requests%rowtype;
begin
  select * into r from requests where id = p_request_id;
  if not found then raise exception 'No such request.'; end if;
  if auth.uid() is null or r.requested_by is distinct from auth.uid() then
    raise exception 'Only the person who raised a request can delete it.';
  end if;
  if r.deleted_at is not null then return; end if;
  if r.status not in ('draft', 'submitted', 'in_review', 'changes_requested') then
    raise exception 'This request has already been finished, so it can no longer be deleted.';
  end if;

  update requests set deleted_at = now(), current_holder = null where id = p_request_id;

  insert into request_assignment_history (request_id, from_user, to_user, acted_by, action, note)
  values (p_request_id, r.current_holder, null, auth.uid(), 'deleted', null);
end;
$$;

revoke execute on function delete_own_request(uuid)                     from public, anon;
revoke execute on function claim_request(uuid)                          from public, anon;
revoke execute on function can_claim_request(uuid)                      from public, anon;
revoke execute on function my_claimable_request_ids()                   from public, anon;
revoke execute on function is_eligible_stage_holder(uuid, uuid, uuid)   from public, anon;
revoke execute on function top_tier_holder_count(uuid, uuid)            from public, anon;

grant execute on function delete_own_request(uuid)                      to authenticated;
grant execute on function claim_request(uuid)                           to authenticated;
grant execute on function can_claim_request(uuid)                       to authenticated;
grant execute on function my_claimable_request_ids()                    to authenticated;
grant execute on function is_eligible_stage_holder(uuid, uuid, uuid)    to authenticated;
grant execute on function top_tier_holder_count(uuid, uuid)             to authenticated;
