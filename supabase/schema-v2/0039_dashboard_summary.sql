-- 0039 — dashboard_summary(): aggregate request analytics for the dashboard
-- ============================================================
-- One call returns every number the analytics dashboard draws, so the browser
-- never downloads thousands of request rows to count them.
--
-- SECURITY INVOKER on purpose (the default, stated here so nobody "fixes" it):
-- the function runs as the caller, so the `requests` RLS policy
-- (can_see_request) scopes every count. The captain gets the whole instance, a
-- dean gets their subtree, a mentor gets what they can see — with no new
-- authorization logic to get wrong. A SECURITY DEFINER version would have to
-- re-implement that scoping and would leak across programmes if it slipped.
--
-- What is NOT here, because it is not recorded: internal vs external, and
-- whether an event is running now. Neither exists as data (there are no
-- field_definitions yet). They need structured fields or separate categories
-- first; this reports what the schema actually holds.

create or replace function dashboard_summary(p_months int default 12)
returns jsonb language sql stable set search_path = public as $$
  with r as (
    select q.id, q.status, q.category_id, q.org_unit_id, q.current_stage_id,
           coalesce(q.submitted_at, q.created_at) as filed_at, q.closed_at
    from requests q
  ),
  kind as (   -- the three outcomes the charts care about
    select r.*,
      case when r.status in ('approved', 'reviewed') then 'approved'
           when r.status = 'rejected' then 'rejected'
           else 'in_progress' end as outcome
    from r
  )
  select jsonb_build_object(
    'total',        (select count(*) from kind),
    'approved',     (select count(*) from kind where outcome = 'approved'),
    'rejected',     (select count(*) from kind where outcome = 'rejected'),
    'in_progress',  (select count(*) from kind where outcome = 'in_progress'),
    'last_30',      (select count(*) from kind where filed_at >= now() - interval '30 days'),
    'prev_30',      (select count(*) from kind
                     where filed_at >= now() - interval '60 days' and filed_at < now() - interval '30 days'),
    -- Decided requests only: an open one has no decision time yet.
    'avg_decision_hours', (select round((avg(extract(epoch from (closed_at - filed_at)) / 3600))::numeric, 1)
                          from kind where outcome <> 'in_progress' and closed_at is not null),
    'by_status',    coalesce((select jsonb_agg(jsonb_build_object('status', status, 'count', n) order by n desc)
                              from (select status, count(*) n from kind group by status) s), '[]'::jsonb),
    'by_category',  coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', n) order by n desc)
                              from (select c.name, count(*) n from kind k
                                    join request_categories c on c.id = k.category_id group by c.name) s), '[]'::jsonb),
    'by_org_unit',  coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', n) order by n desc)
                              from (select o.name, count(*) n from kind k
                                    join org_units o on o.id = k.org_unit_id group by o.name) s), '[]'::jsonb),
    -- Open requests only, by the stage they are waiting at.
    'pipeline',     coalesce((select jsonb_agg(jsonb_build_object('stage', stage, 'count', n) order by n desc)
                              from (select coalesce(cs.name, 'No stage') as stage, count(*) n from kind k
                                    left join category_stages cs on cs.id = k.current_stage_id
                                    where k.outcome = 'in_progress' group by 1) s), '[]'::jsonb),
    -- Filed per calendar month, split by outcome, oldest first. generate_series
    -- fills empty months so the time axis has no gaps.
    'by_month',     coalesce((select jsonb_agg(jsonb_build_object(
                                'month', to_char(m, 'YYYY-MM-01'),
                                'approved',    coalesce(a.n, 0),
                                'rejected',    coalesce(j.n, 0),
                                'in_progress', coalesce(p.n, 0)) order by m)
                              from generate_series(date_trunc('month', now()) - make_interval(months => greatest(p_months, 1) - 1),
                                                   date_trunc('month', now()), interval '1 month') m
                              left join lateral (select count(*) n from kind where outcome = 'approved'    and date_trunc('month', filed_at) = m) a on true
                              left join lateral (select count(*) n from kind where outcome = 'rejected'    and date_trunc('month', filed_at) = m) j on true
                              left join lateral (select count(*) n from kind where outcome = 'in_progress' and date_trunc('month', filed_at) = m) p on true
                             ), '[]'::jsonb)
  );
$$;

grant execute on function dashboard_summary(int) to authenticated;
