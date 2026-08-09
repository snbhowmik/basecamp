-- Basecamp v1.0.0 — Wizard Config Table RLS
-- ============================================================
-- 0001/0002 deliberately left priority_levels, tags, departments, classes,
-- allowed_login_domains, request_types, request_categories,
-- category_first_hop_options and field_definitions without RLS, because the
-- first-boot setup wizard (see app/src/lib/wizard.ts) has to write to them
-- before any admin account — or even the 'admin' tag itself — exists. Once
-- setup is done, that's a standing gap: any authenticated user could rewrite
-- the org's priority levels, departments, or request taxonomy.
--
-- The fix is a single bootstrap predicate: while no user has been granted
-- the 'admin' tag yet, these tables are open (matches what the wizard needs,
-- including the anon-key domain insert in step 1, before the admin account
-- exists at all). The moment the wizard's last step grants the 'admin' tag
-- to user_tags, is_bootstrapping() flips to false forever and every write
-- after that requires has_tag('admin') and a completed MFA challenge — the
-- same convention every other admin-write policy in 0002 already uses.
--
-- Known residual risk: between wizard step 1 (admin domain added, admin
-- account created) and step 4 (admin tag granted), any other signup on the
-- same allowed domain could theoretically race to claim the 'admin' tag
-- first, since is_bootstrapping() is true for anyone until that grant lands.
-- Mitigation is operational, not technical: run the wizard to completion in
-- one sitting on a fresh instance, before advertising it or opening signups
-- beyond the admin's own account. Revisit if that's not an acceptable
-- assumption for a given deployment.

create or replace function is_bootstrapping()
returns boolean language sql security definer stable as $$
  select not exists (
    select 1 from user_tags ut
    join tags t on t.id = ut.tag_id
    where t.code = 'admin'
  );
$$;

-- Exposed as POST /rest/v1/rpc/is_bootstrapping — the wizard calls this
-- pre-auth (app/src/lib/wizard.ts#isSetupComplete) to decide whether to show
-- itself, so anon needs EXECUTE explicitly rather than relying on whatever
-- default privilege behaviour this Postgres image ships with.
grant execute on function is_bootstrapping() to anon, authenticated;

-- ============================================================
-- BOOTSTRAP HOLE IN 0002: user_tags_admin_write / user_levels_admin_write
-- are `for all` and require has_tag('admin') — which is false for the exact
-- insert that grants the first admin their tag. Add an insert-only bootstrap
-- policy; RLS OR's multiple permissive policies together, so this doesn't
-- weaken the existing admin-only policy, it just covers the one insert that
-- has to happen before that fact exists.
-- ============================================================

create policy user_tags_bootstrap_insert on user_tags for insert
with check (is_bootstrapping());

create policy user_levels_bootstrap_insert on user_levels for insert
with check (is_bootstrapping());

-- ============================================================
-- ENABLE + FORCE RLS
-- ============================================================

alter table priority_levels enable row level security;
alter table priority_levels force row level security;
alter table tags enable row level security;
alter table tags force row level security;
alter table departments enable row level security;
alter table departments force row level security;
alter table classes enable row level security;
alter table classes force row level security;
alter table allowed_login_domains enable row level security;
alter table allowed_login_domains force row level security;
alter table request_types enable row level security;
alter table request_types force row level security;
alter table request_categories enable row level security;
alter table request_categories force row level security;
alter table category_first_hop_options enable row level security;
alter table category_first_hop_options force row level security;
alter table field_definitions enable row level security;
alter table field_definitions force row level security;

-- ============================================================
-- PRIORITY_LEVELS — read is public (unauthenticated wizard-complete
-- check in app/src/lib/wizard.ts#isSetupComplete relies on this)
-- ============================================================

create policy priority_levels_read on priority_levels for select
using (true);

create policy priority_levels_write on priority_levels for insert
with check (is_bootstrapping() or (has_tag('admin') and has_mfa()));

create policy priority_levels_update on priority_levels for update
using (has_tag('admin') and has_mfa());

create policy priority_levels_delete on priority_levels for delete
using (has_tag('admin') and has_mfa());

-- ============================================================
-- TAGS
-- ============================================================

create policy tags_read on tags for select
using (auth.uid() is not null);

create policy tags_write on tags for insert
with check (is_bootstrapping() or (has_tag('admin') and has_mfa()));

create policy tags_update on tags for update
using (has_tag('admin') and has_mfa());

create policy tags_delete on tags for delete
using (has_tag('admin') and has_mfa());

-- ============================================================
-- DEPARTMENTS
-- ============================================================

create policy departments_read on departments for select
using (auth.uid() is not null);

create policy departments_write on departments for insert
with check (is_bootstrapping() or (has_tag('admin') and has_mfa()));

create policy departments_update on departments for update
using (has_tag('admin') and has_mfa());

create policy departments_delete on departments for delete
using (has_tag('admin') and has_mfa());

-- ============================================================
-- CLASSES — same shape as departments, same oversight fixed here
-- ============================================================

create policy classes_read on classes for select
using (auth.uid() is not null);

create policy classes_write on classes for insert
with check (has_tag('admin') and has_mfa());

create policy classes_update on classes for update
using (has_tag('admin') and has_mfa());

create policy classes_delete on classes for delete
using (has_tag('admin') and has_mfa());

-- ============================================================
-- ALLOWED_LOGIN_DOMAINS — no public read (avoid leaking the domain
-- allowlist to anyone but admins); write allowed pre-auth during
-- bootstrap because wizard step 1 inserts the admin's own domain
-- before the admin account exists (see wizard.ts#ensureDomainAllowed)
-- ============================================================

-- Bootstrap needs this to read too, not just write: supabase-js's upsert
-- defaults to `Prefer: return=representation` (it wants the row back), and
-- Postgres requires a table's SELECT policy to pass for a RETURNING clause
-- on an RLS-protected table, on top of the INSERT policy's WITH CHECK. An
-- admin-only read policy would make the wizard's own bootstrap-phase
-- domain inserts (step 1, pre-auth, and step 3, authenticated but not yet
-- admin-tagged — see wizard.ts) fail with "new row violates row-level
-- security policy" despite the insert itself being permitted.
create policy allowed_login_domains_read on allowed_login_domains for select
using (is_bootstrapping() or has_tag('admin'));

create policy allowed_login_domains_write on allowed_login_domains for insert
with check (is_bootstrapping() or (has_tag('admin') and has_mfa()));

create policy allowed_login_domains_update on allowed_login_domains for update
using (has_tag('admin') and has_mfa());

create policy allowed_login_domains_delete on allowed_login_domains for delete
using (has_tag('admin') and has_mfa());

-- ============================================================
-- REQUEST TAXONOMY — request_types, request_categories, and their
-- children. Read is broad (every logged-in user needs these to build
-- and browse request forms); write is admin-only after bootstrap.
-- ============================================================

create policy request_types_read on request_types for select
using (auth.uid() is not null);

create policy request_types_write on request_types for insert
with check (is_bootstrapping() or (has_tag('admin') and has_mfa()));

create policy request_types_update on request_types for update
using (has_tag('admin') and has_mfa());

create policy request_types_delete on request_types for delete
using (has_tag('admin') and has_mfa());

create policy request_categories_read on request_categories for select
using (auth.uid() is not null);

create policy request_categories_write on request_categories for insert
with check (is_bootstrapping() or (has_tag('admin') and has_mfa()));

create policy request_categories_update on request_categories for update
using (has_tag('admin') and has_mfa());

create policy request_categories_delete on request_categories for delete
using (has_tag('admin') and has_mfa());

create policy category_first_hop_options_read on category_first_hop_options for select
using (auth.uid() is not null);

create policy category_first_hop_options_write on category_first_hop_options for all
using (has_tag('admin') and has_mfa());

create policy field_definitions_read on field_definitions for select
using (auth.uid() is not null);

create policy field_definitions_write on field_definitions for all
using (has_tag('admin') and has_mfa());
