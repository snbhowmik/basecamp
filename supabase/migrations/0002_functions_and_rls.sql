-- Basecamp v1.0.0 — Authorization
-- ============================================================
-- Every relationship check is written ONCE as a function and reused in every
-- policy that needs it. Never inline the same join logic in multiple
-- policies — that's how one correct update and nine stale copies happens.

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

create or replace function my_rank()
returns int language sql security definer stable as $$
  select pl.rank
  from user_levels ul
  join priority_levels pl on pl.id = ul.level_id
  where ul.user_id = auth.uid();
$$;

create or replace function has_tag(tag_code text)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from user_tags ut
    join tags t on t.id = ut.tag_id
    where ut.user_id = auth.uid() and t.code = tag_code
  );
$$;

create or replace function is_hod_of(dept_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1
    from user_tags ut_role
    join tags t_role on t_role.id = ut_role.tag_id and t_role.code = 'hod'
    join user_tags ut_dept on ut_dept.user_id = ut_role.user_id
    join departments d on d.tag_id = ut_dept.tag_id
    where ut_role.user_id = auth.uid()
      and d.id = dept_id
  );
$$;

create or replace function is_mentor_of(p_class_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1
    from user_tags ut_role
    join tags t_role on t_role.id = ut_role.tag_id and t_role.code = 'mentor'
    join user_tags ut_class on ut_class.user_id = ut_role.user_id
    join classes c on c.tag_id = ut_class.tag_id
    where ut_role.user_id = auth.uid()
      and c.id = p_class_id
  );
$$;

create or replace function has_dashboard_access(dept_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from dashboard_grants dg
    where dg.user_id = auth.uid() and dg.department_id = dept_id
  );
$$;

create or replace function has_mfa()
returns boolean language sql stable as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2';
$$;

create or replace function is_base_level()
returns boolean language sql security definer stable as $$
  select my_rank() = (select max(rank) from priority_levels);
$$;

-- ============================================================
-- ENABLE + FORCE RLS ON EVERY USER-DATA TABLE
-- ============================================================

alter table profiles enable row level security;
alter table profiles force row level security;
alter table requests enable row level security;
alter table requests force row level security;
alter table request_comments enable row level security;
alter table request_comments force row level security;
alter table request_attachments enable row level security;
alter table request_attachments force row level security;
alter table request_participants enable row level security;
alter table request_participants force row level security;
alter table request_watchers enable row level security;
alter table request_watchers force row level security;
alter table request_assignment_history enable row level security;
alter table request_assignment_history force row level security;
alter table canvases enable row level security;
alter table canvases force row level security;
alter table canvas_revisions enable row level security;
alter table canvas_revisions force row level security;
alter table signatures enable row level security;
alter table signatures force row level security;
alter table signature_assets enable row level security;
alter table signature_assets force row level security;
alter table generated_documents enable row level security;
alter table generated_documents force row level security;
alter table dashboard_grants enable row level security;
alter table dashboard_grants force row level security;
alter table user_tags enable row level security;
alter table user_tags force row level security;
alter table user_levels enable row level security;
alter table user_levels force row level security;
alter table student_profiles enable row level security;
alter table student_profiles force row level security;

-- ============================================================
-- PROFILES
-- ============================================================

create policy profiles_read_own on profiles for select
using (id = auth.uid());

create policy profiles_read_staff on profiles for select
using (not is_base_level());   -- any non-student can browse profiles for search-and-forward

create policy profiles_update_own on profiles for update
using (id = auth.uid())
with check (id = auth.uid());

-- ============================================================
-- USER_TAGS / USER_LEVELS — the permission system itself
-- ============================================================

create policy user_tags_read_own on user_tags for select
using (user_id = auth.uid());

create policy user_tags_read_staff on user_tags for select
using (not is_base_level());

create policy user_tags_admin_write on user_tags for all
using (has_tag('admin') and has_mfa());

create policy user_levels_read_own on user_levels for select
using (user_id = auth.uid());

create policy user_levels_admin_write on user_levels for all
using (has_tag('admin') and has_mfa());

-- ============================================================
-- STUDENT_PROFILES
-- ============================================================

create policy student_profiles_self on student_profiles for select
using (user_id = auth.uid());

create policy student_profiles_mentor on student_profiles for select
using (is_mentor_of(class_id));

create policy student_profiles_hod on student_profiles for select
using (is_hod_of(department_id));

create policy student_profiles_dashboard on student_profiles for select
using (has_dashboard_access(department_id));

create policy student_profiles_admin on student_profiles for all
using (has_tag('admin'));

-- ============================================================
-- REQUESTS
-- ============================================================

create policy requests_visibility on requests for select
using (
  requested_by = auth.uid()
  or current_holder = auth.uid()
  or exists (select 1 from request_watchers w where w.request_id = requests.id and w.user_id = auth.uid())
  or exists (select 1 from request_assignment_history h where h.request_id = requests.id and h.to_user = auth.uid())
  or exists (
    select 1 from student_profiles sp
    where sp.user_id = requests.requested_by
      and has_dashboard_access(sp.department_id)
  )
  or has_tag('admin')
);

create policy requests_student_insert on requests for insert
with check (requested_by = auth.uid());

create policy requests_holder_update on requests for update
using (current_holder = auth.uid() and has_mfa())
with check (current_holder = auth.uid());

create policy requests_owner_update_draft on requests for update
using (requested_by = auth.uid() and status = 'draft');

-- ============================================================
-- COMMENTS — internal note protection
-- ============================================================

create policy comments_visibility on request_comments for select
using (
  visibility = 'public'
  or not is_base_level()
);

create policy comments_insert on request_comments for insert
with check (author_id = auth.uid());

create or replace function block_student_internal_comment()
returns trigger language plpgsql as $$
begin
  if new.visibility = 'internal' and is_base_level() then
    raise exception 'Students cannot author internal comments.';
  end if;
  return new;
end;
$$;

create trigger check_internal_author
  before insert on request_comments
  for each row execute function block_student_internal_comment();

-- ============================================================
-- REQUEST_PARTICIPANTS — includes parent consent data
-- ============================================================

create policy participants_visibility on request_participants for select
using (
  student_id = auth.uid()
  or exists (select 1 from requests r where r.id = request_id and r.requested_by = auth.uid())
  or exists (select 1 from requests r where r.id = request_id and r.current_holder = auth.uid())
  or exists (select 1 from request_watchers w where w.request_id = request_participants.request_id and w.user_id = auth.uid())
);

-- Only staff (not base level) can record parent consent
create policy participants_consent_update on request_participants for update
using (not is_base_level() and has_mfa());

-- ============================================================
-- ATTACHMENTS
-- ============================================================

create policy attachments_visibility on request_attachments for select
using (
  exists (select 1 from requests r where r.id = request_id and (
    r.requested_by = auth.uid()
    or r.current_holder = auth.uid()
    or exists (select 1 from request_watchers w where w.request_id = r.id and w.user_id = auth.uid())
  ))
  or has_tag('admin')
);

create policy attachments_insert on request_attachments for insert
with check (uploaded_by = auth.uid());

-- ============================================================
-- WATCHERS
-- ============================================================

create policy watchers_visibility on request_watchers for select
using (
  user_id = auth.uid()
  or exists (select 1 from requests r where r.id = request_id and r.requested_by = auth.uid())
);

-- ============================================================
-- CANVAS
-- ============================================================

create policy canvas_visibility on canvases for select
using (
  visibility = 'public'
  or not is_base_level()
  or owner_id = auth.uid()
);

create policy canvas_revisions_visibility on canvas_revisions for select
using (
  exists (
    select 1 from canvases c where c.id = canvas_id and (
      c.visibility = 'public' or not is_base_level() or c.owner_id = auth.uid()
    )
  )
);

-- ============================================================
-- SIGNATURES & SIGNATURE ASSETS
-- ============================================================

create policy signatures_visibility on signatures for select
using (
  exists (select 1 from requests r where r.id = request_id and (
    r.requested_by = auth.uid()
    or r.current_holder = auth.uid()
    or exists (select 1 from request_watchers w where w.request_id = r.id and w.user_id = auth.uid())
  ))
);

create policy signatures_insert on signatures for insert
with check (signer_id = auth.uid() and has_mfa());

create policy signature_assets_own on signature_assets for all
using (user_id = auth.uid());

create policy signature_assets_read_staff on signature_assets for select
using (not is_base_level());   -- needed so documents can be generated referencing anyone's stamp

-- ============================================================
-- GENERATED DOCUMENTS
-- ============================================================

create policy generated_documents_visibility on generated_documents for select
using (
  exists (select 1 from requests r where r.id = request_id and (
    r.requested_by = auth.uid()
    or r.current_holder = auth.uid()
    or exists (select 1 from request_watchers w where w.request_id = r.id and w.user_id = auth.uid())
  ))
);

-- ============================================================
-- DASHBOARD GRANTS
-- ============================================================

create policy dashboard_grants_self on dashboard_grants for select
using (user_id = auth.uid());

create policy dashboard_grants_admin on dashboard_grants for all
using (has_tag('admin') and has_mfa());

-- ============================================================
-- ASSIGNMENT HISTORY
-- ============================================================

create policy assignment_history_visibility on request_assignment_history for select
using (
  exists (select 1 from requests r where r.id = request_id and (
    r.requested_by = auth.uid()
    or r.current_holder = auth.uid()
    or exists (select 1 from request_watchers w where w.request_id = r.id and w.user_id = auth.uid())
  ))
);

create policy assignment_history_insert on request_assignment_history for insert
with check (from_user = auth.uid() or from_user is null);

-- ============================================================
-- MANDATORY WATCHERS TRIGGER — Mentor + HOD, always, on submit
-- ============================================================

create or replace function add_mandatory_watchers()
returns trigger language plpgsql security definer as $$
declare
  v_class_id uuid;
  v_dept_id  uuid;
  v_mentor   uuid;
  v_hod      uuid;
begin
  if new.status = 'submitted' and (old.status is null or old.status = 'draft') then
    select class_id, department_id into v_class_id, v_dept_id
    from student_profiles where user_id = new.requested_by;

    select ut.user_id into v_mentor
    from user_tags ut
    join tags t on t.id = ut.tag_id and t.code = 'mentor'
    join user_tags ut_class on ut_class.user_id = ut.user_id
    join classes c on c.tag_id = ut_class.tag_id and c.id = v_class_id
    limit 1;

    select ut.user_id into v_hod
    from user_tags ut
    join tags t on t.id = ut.tag_id and t.code = 'hod'
    join user_tags ut_dept on ut_dept.user_id = ut.user_id
    join departments d on d.tag_id = ut_dept.tag_id and d.id = v_dept_id
    limit 1;

    if v_mentor is not null then
      insert into request_watchers (request_id, user_id, reason)
      values (new.id, v_mentor, 'mandatory_mentor') on conflict do nothing;
    end if;
    if v_hod is not null then
      insert into request_watchers (request_id, user_id, reason)
      values (new.id, v_hod, 'mandatory_hod') on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;

create trigger requests_add_watchers
  after insert or update on requests
  for each row execute function add_mandatory_watchers();

-- ============================================================
-- ATTACHMENT PURGE TRIGGER — schedule deletion on close, per category rule
-- ============================================================

create or replace function schedule_attachment_purge()
returns trigger language plpgsql security definer as $$
declare
  v_retain boolean;
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    select retain_attachments_after_close into v_retain
    from request_categories where id = new.category_id;

    if not v_retain then
      update request_attachments
      set purge_after = now() + interval '7 days'   -- grace period before actual deletion
      where request_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

create trigger requests_schedule_purge
  after update on requests
  for each row execute function schedule_attachment_purge();

-- Actual object deletion (from Garage) happens in a scheduled job outside
-- Postgres — this only marks rows as due. See README.md for the cron job
-- that reads `attachments_pending_purge` and calls the Storage API to delete,
-- then removes the row.

-- ============================================================
-- DOMAIN-RESTRICTED SIGNUP — enforced server-side, not just in the UI
-- ============================================================

-- set search_path = public is required here, not defensive styling: this
-- fires on auth.users in supabase_auth_admin's session, whose search_path
-- is pinned to `auth` only by the base image — see the matching comment on
-- handle_new_user() in 0001_schema.sql for the full explanation.
create or replace function check_allowed_domain()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_domain text;
begin
  v_domain := split_part(new.email, '@', 2);
  if not exists (
    select 1 from allowed_login_domains where domain = v_domain and is_active
  ) then
    raise exception 'Email domain % is not permitted to register.', v_domain;
  end if;
  return new;
end;
$$;

create trigger auth_users_domain_check
  before insert on auth.users
  for each row execute function check_allowed_domain();
