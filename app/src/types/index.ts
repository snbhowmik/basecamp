// Mirrors supabase/schema-v2/. Keep in sync by hand — there's no
// generated-types pipeline yet.

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  mfa_enrolled: boolean;
  created_at: string;
  updated_at: string;
}

export interface PriorityLevel {
  id: string;
  rank: number;
  name: string;
  description: string | null;
  is_base: boolean;
  is_active: boolean;
}

export interface Tag {
  id: string;
  code: string;
  label: string;
  parent_tag_id: string | null;
  tag_type: string | null;
  is_active: boolean;
}

// v2 replaced departments+classes with a tree: org_units (faculty →
// programme) → batches → sections.
export type OrgUnitType = 'faculty' | 'programme';

export interface OrgUnit {
  id: string;
  parent_id: string | null;
  unit_type: OrgUnitType;
  name: string;
  code: string;
  campus: string | null;
  tag_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Batch {
  id: string;
  org_unit_id: string;
  name: string;
  start_year: number;
  end_year: number;
  mode: string;
  reg_no_prefix: string | null;
  reg_no_serial_len: number | null;
  is_active: boolean;
  created_at: string;
}

export interface Section {
  id: string;
  batch_id: string;
  name: string;
  serial_from: number | null;
  serial_to: number | null;
  tag_id: string | null;
  is_active: boolean;
}

export interface AllowedLoginDomain {
  id: string;
  domain: string;
  is_active: boolean;
}

// v2 merged student_profiles and staff into one table, discriminated by
// member_type: a student carries reg_no, a staff member carries fet_id.
export type MemberType = 'student' | 'staff';

export interface MemberProfile {
  user_id: string;
  member_type: MemberType;
  reg_no: string | null;
  fet_id: string | null;
  org_unit_id: string | null;
  batch_id: string | null;
  section_id: string | null;
  cgpa: number | null;
  cgpa_proof_key: string | null;
  cgpa_verified_by: string | null;
  cgpa_verified_at: string | null;
  cgpa_updated_at: string | null;
  is_complete: boolean;
  created_at: string;
}

// v2 replaced user_levels (one level per user) with role_assignments:
// several, each scoped to an org unit or section, and time-boxed.
export type RoleKind = 'academic' | 'club' | 'event' | 'admin';

export interface RoleAssignment {
  id: string;
  user_id: string;
  level_id: string;
  org_unit_id: string | null;
  section_id: string | null;
  role_kind: RoleKind;
  is_primary: boolean;
  valid_from: string;
  valid_until: string | null;
  assigned_by: string | null;
  assigned_at: string;
}

// An invite: the target account doesn't exist yet — it's granted the declared
// level/tags automatically the moment that email signs up (self-service
// registration or the /invite/<token> link, both via the normal signup flow).
export interface PendingAssignment {
  id: string;
  email: string;
  level_id: string;
  tag_codes: string[];
  org_unit_id: string | null;
  batch_id: string | null;
  section_id: string | null;
  role_kind: RoleKind;
  member_type: MemberType;
  reg_no: string | null;
  fet_id: string | null;
  invited_by: string | null;
  invite_token: string;
  created_at: string;
  consumed_at: string | null;
  // Delivery bookkeeping. sent_at null with a non-null error means the mailer
  // tried and failed; null/null means it hasn't picked the row up yet.
  invite_email_sent_at: string | null;
  invite_email_attempts: number;
  invite_email_error: string | null;
}

export type DecisionMode = 'approval' | 'log_only';

// v2 dropped 'cancelled'.
export type RequestStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'rejected'
  | 'reviewed'
  | 'closed';

// decision_mode lives on the type in v2, not on each category.
export interface RequestType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  decision_mode: DecisionMode;
  is_active: boolean;
}

export type Classification = 'tech' | 'non_tech';

export interface RequestCategory {
  id: string;
  request_type_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  classification: Classification | null;
  retain_attachments_after_close: boolean;
  is_active: boolean;
  sort_order: number;
}

// ------------------------------------------------------------------
// App-level view state
// ------------------------------------------------------------------

export type AppView = 'loading' | 'wizard' | 'login' | 'dashboard';
