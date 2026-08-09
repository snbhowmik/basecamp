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
