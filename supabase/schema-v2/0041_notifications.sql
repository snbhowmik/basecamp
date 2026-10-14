-- 0041 — notifications, derived from what is already recorded
-- ============================================================
-- Nothing new is written when a request moves: every event a person would be
-- told about is already a row in request_assignment_history (landed on you,
-- decided, advanced) or request_comments. my_notifications() reads those as the
-- caller, so row-level security decides what is visible (SECURITY INVOKER, on
-- purpose — a DEFINER version would have to re-implement can_see_request).
--
-- The only state added is when each person last looked: notification_state.
-- "Unread" is `at > seen_at`, so marking everything read is one timestamp, not a
-- row per notification.

create table if not exists notification_state (
  user_id uuid primary key references profiles(id) on delete cascade,
  seen_at timestamptz not null default 'epoch'
);

alter table notification_state enable row level security;
alter table notification_state force row level security;
-- Read your own marker. Writes go through mark_notifications_seen() only.
create policy notification_state_read on notification_state for select to authenticated
  using (user_id = auth.uid() and mfa_satisfied());

create or replace function mark_notifications_seen()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  insert into notification_state (user_id, seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set seen_at = excluded.seen_at;
end;
$$;

create or replace function my_notifications(p_limit int default 50)
returns jsonb language sql stable set search_path = public as $$
  with me as (select auth.uid() as id),
  feed as (
    -- A request landed on your desk.
    select h.id::text || ':assigned' as nid, 'assigned' as kind, h.request_id, h.created_at as at,
           h.acted_by as actor, null::text as detail
    from request_assignment_history h, me
    where h.to_user = me.id and h.acted_by is distinct from me.id
      and h.action in ('submitted', 'stage_advanced', 'forwarded')
    union all
    -- Something was decided on a request you raised.
    select h.id::text || ':outcome', 'outcome:' || h.action, h.request_id, h.created_at, h.acted_by, h.note
    from request_assignment_history h
    join requests r on r.id = h.request_id, me
    where r.requested_by = me.id and h.acted_by is distinct from me.id
      and h.action in ('approved', 'rejected', 'changes_requested', 'reviewed')
    union all
    -- A request you raised moved to its next stage.
    select h.id::text || ':progress', 'progress', h.request_id, h.created_at, h.acted_by, h.note
    from request_assignment_history h
    join requests r on r.id = h.request_id, me
    where r.requested_by = me.id and h.acted_by is distinct from me.id and h.action = 'stage_advanced'
    union all
    -- Someone else commented on a request you raised or are holding.
    select c.id::text || ':comment', 'comment', c.request_id, c.created_at, c.author_id, left(c.body, 140)
    from request_comments c
    join requests r on r.id = c.request_id, me
    where c.author_id <> me.id and (r.requested_by = me.id or r.current_holder = me.id)
  ),
  shaped as (
    select f.nid, f.kind, f.request_id, r.reference_number, r.title, f.at, f.detail,
           p.full_name as actor_name
    from feed f
    join requests r on r.id = f.request_id
    left join profiles p on p.id = f.actor
    order by f.at desc
    limit greatest(least(coalesce(p_limit, 50), 200), 1)
  )
  select jsonb_build_object(
    'seen_at', (select seen_at from notification_state where user_id = auth.uid()),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', nid, 'kind', kind, 'request_id', request_id, 'reference', reference_number, 'title', title,
        'at', at, 'detail', detail, 'actor', actor_name) order by at desc) from shaped), '[]'::jsonb)
  );
$$;

grant execute on function mark_notifications_seen() to authenticated;
grant execute on function my_notifications(int) to authenticated;
