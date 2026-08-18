import { supabase } from './supabase';
import type { RequestStatus, DecisionMode } from '../types';

// v2 moved the OD-specific columns (travel_scope, event_name, organised_by,
// event_location, start_date, end_date) out of `requests` and into
// request_field_values, driven by field_definitions per category. `description`
// became `body`. Anything reading those fields now goes through
// listFieldValues() rather than off the request row.
export interface RequestRow {
  id: string;
  reference_number: string;
  category_id: string;
  decision_mode: DecisionMode;
  title: string;
  body: string | null;
  status: RequestStatus;
  requested_by: string;
  requested_as: string | null;
  current_holder: string | null;
  current_level_id: string | null;
  org_unit_id: string | null;
  submitted_at: string | null;
  closed_at: string | null;
  created_at: string;
  request_categories?: { name: string } | null;
  requester?: { full_name: string; email: string } | null;
}

// RLS (can_see_request) does the scoping — a student sees their own, a holder
// sees what's on their desk, watchers see what they watch, and level
// visibility rules cover the rest. No client-side filter needed or trusted
// here.
export async function listVisibleRequests(): Promise<RequestRow[]> {
  const { data, error } = await supabase
    .from('requests')
    .select('*, request_categories(name), requester:profiles!requests_requested_by_fkey(full_name, email)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as RequestRow[];
}

export async function getRequest(id: string): Promise<RequestRow | null> {
  const { data, error } = await supabase
    .from('requests')
    .select('*, request_categories(name), requester:profiles!requests_requested_by_fkey(full_name, email)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as RequestRow | null;
}

export interface FirstHopCandidate {
  user_id: string;
  full_name: string;
  email: string;
  option_label: string;
}

export async function listFirstHopCandidates(categoryId: string): Promise<FirstHopCandidate[]> {
  const { data, error } = await supabase.rpc('list_first_hop_candidates', { p_category_id: categoryId });
  if (error) throw error;
  return (data ?? []) as FirstHopCandidate[];
}

// `actedAs` is the "acting as" context switcher (PRD-V2 D-1): a user holding
// several role_assignments declares which one they are using. null means
// their primary. The database re-checks that the caller actually holds it.
export interface SubmitRequestInput {
  categoryId: string;
  title: string;
  body?: string;
  firstHop?: string | null;
  actedAs?: string | null;
}

export async function submitRequest(input: SubmitRequestInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_and_submit_request', {
    p_category_id: input.categoryId,
    p_title: input.title,
    p_body: input.body ?? null,
    p_first_hop: input.firstHop ?? null,
    p_acted_as: input.actedAs ?? null,
  });
  if (error) throw error;
  return data as string;
}

// Custom per-category fields — the replacement for the OD columns that used
// to sit on `requests`. field_definitions declares them per category; these
// are the values. `value` is jsonb, so a string field arrives as a JSON
// string, not a bare one.
export interface FieldDefinition {
  id: string;
  category_id: string;
  field_key: string;
  label: string;
  field_type: string;
  options: unknown;
  is_required: boolean;
  sort_order: number;
}

export async function listFieldDefinitions(categoryId: string): Promise<FieldDefinition[]> {
  const { data, error } = await supabase
    .from('field_definitions')
    .select('*')
    .eq('category_id', categoryId)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as FieldDefinition[];
}

export interface FieldValue {
  id: string;
  request_id: string;
  definition_id: string;
  value: unknown;
  field_definitions?: { field_key: string; label: string; field_type: string } | null;
}

export async function listFieldValues(requestId: string): Promise<FieldValue[]> {
  const { data, error } = await supabase
    .from('request_field_values')
    .select('*, field_definitions(field_key, label, field_type)')
    .eq('request_id', requestId);
  if (error) throw error;
  return (data ?? []) as FieldValue[];
}

// Written after create_and_submit_request() returns: the RPC takes only the
// fixed columns, and the rfv_write policy lets the requester add values for a
// request they own. There is no server-side validation against
// field_definitions yet (TASK.md tracks it), so required-ness is enforced in
// the form only — do not treat it as a control.
export async function saveFieldValues(
  requestId: string,
  values: { definitionId: string; value: unknown }[],
): Promise<void> {
  const rows = values
    .filter((v) => v.value !== '' && v.value !== null && v.value !== undefined)
    .map((v) => ({ request_id: requestId, definition_id: v.definitionId, value: v.value }));
  if (rows.length === 0) return;
  const { error } = await supabase.from('request_field_values').insert(rows);
  if (error) throw error;
}

export type DecisionAction = 'approved' | 'rejected' | 'changes_requested' | 'reviewed';

export async function decideRequest(
  requestId: string,
  action: DecisionAction,
  note?: string,
  actedAs?: string | null,
) {
  const { error } = await supabase.rpc('decide_request', {
    p_request_id: requestId,
    p_decision: action,
    p_note: note ?? null,
    p_acted_as: actedAs ?? null,
  });
  if (error) throw error;
}

export async function forwardRequest(
  requestId: string,
  toUser: string,
  note?: string,
  actedAs?: string | null,
) {
  const { error } = await supabase.rpc('forward_request', {
    p_request_id: requestId,
    p_to_user: toUser,
    p_note: note ?? null,
    p_acted_as: actedAs ?? null,
  });
  if (error) throw error;
}

export interface ForwardTarget {
  user_id: string;
  full_name: string;
  email: string;
  reg_no: string | null;
  fet_id: string | null;
}

export async function searchForwardTargets(query: string): Promise<ForwardTarget[]> {
  const { data, error } = await supabase.rpc('search_forward_targets', { p_query: query });
  if (error) throw error;
  return (data ?? []) as ForwardTarget[];
}

// Directory search (PRD-V2 §8.1): register-number first, then name/email.
// Wider than searchForwardTargets — use that one for picking a forward
// recipient, this one for looking a person up.
export interface PersonResult extends ForwardTarget {
  org_unit_name: string | null;
  rank_score: number;
}

export async function searchPeople(
  query: string,
  memberType: 'student' | 'staff' | null = null,
  orgUnitId: string | null = null,
  limit = 20,
): Promise<PersonResult[]> {
  const { data, error } = await supabase.rpc('search_people', {
    p_query: query,
    p_member_type: memberType,
    p_org_unit_id: orgUnitId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as PersonResult[];
}

export interface HistoryRow {
  id: string;
  action: string;
  note: string | null;
  created_at: string;
  from_user: string | null;
  to_user: string;
}

export async function listHistory(requestId: string): Promise<HistoryRow[]> {
  const { data, error } = await supabase
    .from('request_assignment_history')
    .select('*')
    .eq('request_id', requestId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as HistoryRow[];
}

export interface CommentRow {
  id: string;
  author_id: string;
  visibility: 'public' | 'internal';
  body: string;
  created_at: string;
}

export async function listComments(requestId: string): Promise<CommentRow[]> {
  const { data, error } = await supabase
    .from('request_comments')
    .select('*')
    .eq('request_id', requestId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as CommentRow[];
}

// Internal comments are never returned to a student session — enforced by RLS
// plus block_base_level_internal_comment(), which stops a lowest-level user
// from even authoring one. This function just posts; it does not decide.
export async function addComment(requestId: string, body: string, visibility: 'public' | 'internal') {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');
  const { error } = await supabase.from('request_comments').insert({
    request_id: requestId,
    author_id: user.id,
    visibility,
    body,
  });
  if (error) throw error;
}
