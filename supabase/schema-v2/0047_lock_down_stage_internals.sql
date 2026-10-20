-- ============================================================
-- Lock down the stage-internal RPCs and the anon paths on the lifecycle RPCs
-- ============================================================
-- Found while reviewing the claimable-stage work.
--
-- `advance_stage` has no caller check and mutates the request (moves the stage,
-- sets the holder). It was created in 0027, after 0021's lockdown, so it kept
-- the default grant and came back executable by `authenticated` AND `anon`. A
-- student could call it on their own request and skip the mentor stage without
-- a signature; an anon caller could too. It is only ever meant to be called
-- from inside `create_and_submit_request` and `decide_request`, both SECURITY
-- DEFINER — those run as the owner, which keeps EXECUTE regardless of these
-- grants, so revoking from everyone else does not break them. `resolve_stage_
-- holder` and `top_tier_holder_count` are internal helpers with the same story.
--
-- `decide_request` / `forward_request` / `record_task_result` must stay callable
-- by `authenticated` (the frontend calls them), but never by `anon`: their
-- holder guards use `is distinct from auth.uid()`, which on an unclaimed request
-- (current_holder NULL) is NULL-vs-NULL for an anon caller — not distinct — so
-- the guard would not fire. `can_see_request` blocks it a layer down, but there
-- is no reason anon should reach these at all. (`claim_request`,
-- `delete_own_request` and the claim read-helpers were locked down in 0046.)

revoke execute on function advance_stage(uuid)                 from public, anon, authenticated;
revoke execute on function resolve_stage_holder(uuid, uuid)    from public, anon, authenticated;
revoke execute on function top_tier_holder_count(uuid, uuid)   from public, anon, authenticated;

-- These carry BOTH a PUBLIC grant and an explicit anon grant from an earlier
-- migration, so anon has to be removed from both PUBLIC and the direct grant.
-- The direct grant to authenticated (0004/0028) survives, and is re-stated.
revoke execute on function decide_request(uuid, text, text, uuid)                  from public, anon;
revoke execute on function forward_request(uuid, uuid, text, uuid)                 from public, anon;
revoke execute on function record_task_result(uuid, uuid, jsonb, uuid, text, uuid) from public, anon;
grant  execute on function decide_request(uuid, text, text, uuid)                  to authenticated;
grant  execute on function forward_request(uuid, uuid, text, uuid)                 to authenticated;
grant  execute on function record_task_result(uuid, uuid, jsonb, uuid, text, uuid) to authenticated;
