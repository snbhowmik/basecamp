-- Basecamp v1.0.0 — EXAMPLE Seed Data — DEMO/REFERENCE ONLY
-- ============================================================
-- Do NOT run this against a real deployment. A real instance gets exactly
-- one account from the wizard — the captain — and every priority level,
-- department, tag, and other account is created by hand afterward, inside
-- the app, by a human at the right level. No fixture data, ever — see
-- README.md "No Fixture Data — the Captain Builds the Org By Hand".
--
-- What's below is the SRM Trichy Cyber Security Dept starting configuration,
-- kept only as a worked example of the *shape* of data the captain would
-- produce by hand, useful for spinning up a disposable demo/test instance.
-- It intentionally does NOT create a captain account or grant the 'admin'
-- tag to anyone — running this alone does not make an instance usable; the
-- wizard is still required for that, on top of this or without it.

-- ============================================================
-- PRIORITY LEVELS
-- ============================================================
insert into priority_levels (rank, name, description) values
  (1, 'Dean-level',    'Institute/faculty oversight'),
  (2, 'HOD-level',     'Department heads'),
  (3, 'Coordinator-level', 'Club coordinators, placement officers, campus life staff'),
  (4, 'Mentor-level',  'Class advisors'),
  (5, 'Student',       'Base level');

-- ============================================================
-- CORE TAGS
-- ============================================================
insert into tags (code, label, tag_type) values
  ('admin',            'Administrator',       'function'),
  ('hod',               'Head of Department',  'function'),
  ('mentor',             'Mentor / Class Advisor','function'),
  ('club_coordinator',   'Club Coordinator',     'function'),
  ('campus_life',        'Campus Life Staff',    'function'),
  ('placement_officer',  'Placement Officer',    'function'),
  ('dean',                'Dean',                  'function');

-- ============================================================
-- REQUEST TYPES & CATEGORY TREE
-- ============================================================
insert into request_types (code, name) values
  ('od_request', 'On-Duty Request'),
  ('achievement', 'Achievement Log');

-- OD Request tree (decision_mode = approval, attachments purged on close)
with rt as (select id from request_types where code = 'od_request')
insert into request_categories (request_type_id, parent_id, code, name, decision_mode, retain_attachments_after_close)
select rt.id, null, 'tech', 'Tech', 'approval', false from rt
union all
select rt.id, null, 'non_tech', 'Non-Tech', 'approval', false from rt;

with tech as (select id from request_categories where code = 'tech'),
     nontech as (select id from request_categories where code = 'non_tech'),
     rt as (select id from request_types where code = 'od_request')
insert into request_categories (request_type_id, parent_id, code, name, decision_mode, retain_attachments_after_close)
select rt.id, tech.id, c.code, c.name, 'approval', false
from rt, tech, (values
  ('hackathon', 'Hackathon'),
  ('symposium', 'Symposium'),
  ('conference', 'Conference'),
  ('placement', 'Placement'),
  ('others_tech', 'Others')
) as c(code, name)
union all
select rt.id, nontech.id, c.code, c.name, 'approval', false
from rt, nontech, (values
  ('clubs', 'Clubs'),
  ('campus_life', 'Campus Life'),
  ('others_non_tech', 'Others')
) as c(code, name);

-- Achievement Log tree (decision_mode = log_only, attachments retained forever)
with rt as (select id from request_types where code = 'achievement')
insert into request_categories (request_type_id, parent_id, code, name, decision_mode, retain_attachments_after_close)
select rt.id, null, c.code, c.name, 'log_only', true
from rt, (values
  ('online_cert', 'Online Certification'),
  ('workshop_training', 'Workshop / Training'),
  ('non_od_event', 'Non-OD Event')
) as c(code, name);

-- ============================================================
-- FIRST-HOP PICKER OPTIONS
-- ============================================================
insert into category_first_hop_options (category_id, label, resolve_tag, is_default)
select id, 'Your Mentor', 'mentor', true from request_categories where code in
  ('hackathon', 'symposium', 'conference', 'others_tech');

insert into category_first_hop_options (category_id, label, resolve_tag, is_default)
select id, 'Placement Officer', 'placement_officer', true from request_categories where code = 'placement';

insert into category_first_hop_options (category_id, label, resolve_tag, is_default)
select id, 'Club Coordinator', 'club_coordinator', true from request_categories where code = 'clubs';

insert into category_first_hop_options (category_id, label, resolve_tag, is_default)
select id, 'Campus Life Staff', 'campus_life', true from request_categories where code = 'campus_life';
