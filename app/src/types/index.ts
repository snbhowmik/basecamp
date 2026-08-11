// Mirrors 0001_schema.sql / 0002_functions_and_rls.sql. Keep in sync by hand —
// there's no generated-types pipeline yet.

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  avatar_key: string | null;
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
  is_active: boolean;
}

export interface Tag {
  id: string;
  code: string;
  label: string;
  tag_type: string | null;
  is_active: boolean;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  tag_id: string | null;
  is_active: boolean;
}

export interface AllowedLoginDomain {
  id: string;
  domain: string;
  is_active: boolean;
}

export interface Class {
  id: string;
  name: string;
  year: number;
  department_id: string;
  tag_id: string | null;
  is_active: boolean;
}

// Mirrors 0004_account_provisioning.sql / 0005_public_registration.sql. An
// invite: the target account doesn't exist yet — it's granted the declared
// level/tags automatically the moment that email signs up (self-service
// registration or the /invite/<token> link, both via the normal signup flow).
export interface PendingAssignment {
  id: string;
  email: string;
  level_id: string;
  tag_codes: string[];
  department_id: string | null;
  class_id: string | null;
  reg_no: string | null;
  year: number | null;
  invited_by: string | null;
  invite_token: string;
  created_at: string;
  consumed_at: string | null;
}

export type DecisionMode = 'approval' | 'log_only';

export type RequestStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'rejected'
  | 'reviewed'
  | 'cancelled'
  | 'closed';

export interface RequestType {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export interface RequestCategory {
  id: string;
  request_type_id: string;
  parent_id: string | null;
  code: string;
  name: string;
  decision_mode: DecisionMode;
  retain_attachments_after_close: boolean;
  is_active: boolean;
  sort_order: number;
}

// ------------------------------------------------------------------
// App-level view state
// ------------------------------------------------------------------

export type AppView = 'loading' | 'wizard' | 'login' | 'dashboard';
