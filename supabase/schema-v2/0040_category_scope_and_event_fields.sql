-- 0040 — internal/external scope on categories, field-definition RPCs, event analytics
-- ============================================================
-- Events are internal or external; an internal one is tech or non-tech, and that
-- decides its route. The category already carries `classification` (tech /
-- non_tech) and its own stages and routing, so scope belongs beside it: the
-- category stays the single place that says what kind of event this is and where
-- it goes. (Routing by tech/non-tech is configured per category in the workflow
-- editor; this migration only records the kind.)
--
-- Event dates are structured fields, not columns: a captain adds `event_start`
-- and `event_end` date fields to a category (create_field_definition) and the
-- dashboard reads those two keys. Nothing is assumed to exist until they do.

alter table request_categories
  add column if not exists scope text check (scope in ('internal', 'external'));

comment on column request_categories.scope is
  'internal | external. Null = not set yet (dashboard shows it as "Not set").';

-- ------------------------------------------------------------------
-- Category writes — scope joins create; set_category_kind edits an existing one.
-- The old 5-argument create_category is replaced, not overloaded: two overloads
-- differing only by a defaulted argument make `rpc('create_category', {...})`
-- ambiguous to PostgREST.
-- ------------------------------------------------------------------
drop function if exists create_category(uuid, uuid, text, text, boolean);

create or replace function create_category(
  p_request_type_id uuid, p_parent_id uuid, p_name text,
  p_classification text default null, p_retain boolean default false,
  p_scope text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform assert_captain();
  if nullif(trim(coalesce(p_scope, '')), '') is not null and trim(p_scope) not in ('internal', 'external') then
    raise exception 'Scope must be internal or external.';
  end if;
  insert into request_categories (request_type_id, parent_id, name, classification, retain_attachments_after_close, scope)
  values (p_request_type_id, p_parent_id, trim(p_name),
          nullif(trim(coalesce(p_classification, '')), ''), coalesce(p_retain, false),
          nullif(trim(coalesce(p_scope, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function set_category_kind(p_id uuid, p_scope text, p_classification text)
returns void language plpgsql security definer set search_path = public as $$
declare v_scope text := nullif(trim(coalesce(p_scope, '')), '');
        v_class text := nullif(trim(coalesce(p_classification, '')), '');
begin
  perform assert_captain();
  if v_scope is not null and v_scope not in ('internal', 'external') then
    raise exception 'Scope must be internal or external.';
  end if;
  if v_class is not null and v_class not in ('tech', 'non_tech') then
    raise exception 'Classification must be tech or non_tech.';
  end if;
  update request_categories set scope = v_scope, classification = v_class where id = p_id;
end;
$$;

-- ------------------------------------------------------------------
-- Field definitions — the form a category asks for. Captain only, re-checked
-- here because SECURITY DEFINER bypasses RLS. Deleting one goes through
-- admin_delete('field_definitions', id), like every other delete.
-- ------------------------------------------------------------------
create or replace function create_field_definition(
  p_category_id uuid, p_key text, p_label text, p_type text,
  p_options jsonb default null, p_required boolean default false
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text := lower(trim(coalesce(p_key, '')));
begin
  perform assert_captain();
  if v_key !~ '^[a-z][a-z0-9_]{0,48}$' then
    raise exception 'A field key is lowercase letters, digits and underscores, starting with a letter.';
  end if;
  if coalesce(trim(p_label), '') = '' then raise exception 'A field needs a label.'; end if;
  if p_type not in ('text', 'textarea', 'number', 'date', 'select') then
    raise exception 'Unknown field type.';
  end if;
  if p_type = 'select' and (p_options is null or jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) = 0) then
    raise exception 'A choice field needs at least one option.';
  end if;
  insert into field_definitions (category_id, field_key, label, field_type, options, is_required, sort_order)
  values (p_category_id, v_key, trim(p_label), p_type,
          case when p_type = 'select' then p_options end, coalesce(p_required, false),
          coalesce((select max(sort_order) + 1 from field_definitions where category_id = p_category_id), 0))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function update_field_definition(p_id uuid, p_label text, p_required boolean, p_options jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_type text;
begin
  perform assert_captain();
  if coalesce(trim(p_label), '') = '' then raise exception 'A field needs a label.'; end if;
  select field_type into v_type from field_definitions where id = p_id;
  if v_type is null then raise exception 'No such field.'; end if;
  update field_definitions
     set label = trim(p_label), is_required = coalesce(p_required, false),
         options = case when v_type = 'select' then coalesce(p_options, options) else options end
   where id = p_id;
end;
$$;

grant execute on function create_category(uuid, uuid, text, text, boolean, text) to authenticated;
grant execute on function set_category_kind(uuid, text, text) to authenticated;
grant execute on function create_field_definition(uuid, text, text, text, jsonb, boolean) to authenticated;
grant execute on function update_field_definition(uuid, text, boolean, jsonb) to authenticated;

-- ------------------------------------------------------------------
-- dashboard_summary(): add scope, tech/non-tech and events (still SECURITY
-- INVOKER, so RLS scopes every number — see 0039).
-- ------------------------------------------------------------------
create or replace function dashboard_summary(p_months int default 12)
returns jsonb language sql stable set search_path = public as $$
  with r as (
    select q.id, q.title, q.status, q.category_id, q.org_unit_id, q.current_stage_id,
           coalesce(q.submitted_at, q.created_at) as filed_at, q.closed_at,
           c.name as category, c.scope, c.classification
    from requests q join request_categories c on c.id = q.category_id
  ),
  kind as (
    select r.*,
      case when r.status in ('approved', 'reviewed') then 'approved'
           when r.status = 'rejected' then 'rejected'
           else 'in_progress' end as outcome
    from r
  ),
  -- Event window from the two structured date fields. A value that is not a
  -- plain YYYY-MM-DD is treated as "no date" rather than failing the whole call.
  ev as (
    select k.id, k.title, k.category, k.scope, k.classification,
           max(case when fd.field_key = 'event_start' and (v.value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
                    then (v.value #>> '{}')::date end) as starts,
           max(case when fd.field_key = 'event_end' and (v.value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
                    then (v.value #>> '{}')::date end) as ends
    from kind k
    left join request_field_values v on v.request_id = k.id
    left join field_definitions fd on fd.id = v.definition_id and fd.field_key in ('event_start', 'event_end')
    where k.outcome = 'approved'
    group by k.id, k.title, k.category, k.scope, k.classification
  ),
  ev2 as (
    select ev.*, coalesce(ends, starts) as last_day,
      case when starts is null then 'undated'
           when starts <= current_date and coalesce(ends, starts) >= current_date then 'ongoing'
           when starts > current_date then 'upcoming'
           else 'past' end as phase
    from ev
  )
  select jsonb_build_object(
    'total',        (select count(*) from kind),
    'approved',     (select count(*) from kind where outcome = 'approved'),
    'rejected',     (select count(*) from kind where outcome = 'rejected'),
    'in_progress',  (select count(*) from kind where outcome = 'in_progress'),
    'last_30',      (select count(*) from kind where filed_at >= now() - interval '30 days'),
    'prev_30',      (select count(*) from kind
                     where filed_at >= now() - interval '60 days' and filed_at < now() - interval '30 days'),
    'avg_decision_hours', (select round((avg(extract(epoch from (closed_at - filed_at)) / 3600))::numeric, 1)
                           from kind where outcome <> 'in_progress' and closed_at is not null),
    'by_status',    coalesce((select jsonb_agg(jsonb_build_object('status', status, 'count', n) order by n desc)
                              from (select status, count(*) n from kind group by status) s), '[]'::jsonb),
    'by_category',  coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', n) order by n desc)
                              from (select category as name, count(*) n from kind group by category) s), '[]'::jsonb),
    'by_scope',     coalesce((select jsonb_agg(jsonb_build_object('scope', scope, 'count', n) order by n desc)
                              from (select coalesce(scope, 'unset') as scope, count(*) n from kind group by 1) s), '[]'::jsonb),
    -- Tech / non-tech is a question about internal events only.
    'by_class',     coalesce((select jsonb_agg(jsonb_build_object('class', cls, 'count', n) order by n desc)
                              from (select coalesce(classification, 'unset') as cls, count(*) n from kind
                                    where scope = 'internal' group by 1) s), '[]'::jsonb),
    'by_org_unit',  coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', n) order by n desc)
                              from (select o.name, count(*) n from kind k
                                    join org_units o on o.id = k.org_unit_id group by o.name) s), '[]'::jsonb),
    'pipeline',     coalesce((select jsonb_agg(jsonb_build_object('stage', stage, 'count', n) order by n desc)
                              from (select coalesce(cs.name, 'No stage') as stage, count(*) n from kind k
                                    left join category_stages cs on cs.id = k.current_stage_id
                                    where k.outcome = 'in_progress' group by 1) s), '[]'::jsonb),
    'events',       jsonb_build_object(
                      'ongoing',  (select count(*) from ev2 where phase = 'ongoing'),
                      'upcoming', (select count(*) from ev2 where phase = 'upcoming'),
                      'past',     (select count(*) from ev2 where phase = 'past'),
                      'undated',  (select count(*) from ev2 where phase = 'undated')),
    -- Happening now first, then the soonest to come; capped so the list stays a glance.
    'event_list',   coalesce((select jsonb_agg(jsonb_build_object(
                                'title', title, 'category', category, 'scope', scope, 'classification', classification,
                                'starts', starts, 'ends', ends, 'phase', phase) order by (phase = 'ongoing') desc, starts)
                              from (select * from ev2 where phase in ('ongoing', 'upcoming') order by (phase = 'ongoing') desc, starts limit 8) l),
                             '[]'::jsonb),
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
