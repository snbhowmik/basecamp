import { supabase } from './supabase';
import type { RequestStatus, DecisionMode } from '../types';

export interface RequestRow {
  id: string;
  reference_number: string;
  category_id: string;
  decision_mode: DecisionMode;
  title: string;
  description: string | null;
  status: RequestStatus;
  travel_scope: 'internal' | 'outstation' | null;
  event_name: string | null;
  organised_by: string | null;
  event_location: string | null;
  start_date: string | null;
  end_date: string | null;
  requested_by: string;
  current_holder: string | null;
  submitted_at: string | null;
  created_at: string;
  request_categories?: { name: string } | null;
  requester?: { full_name: string; email: string } | null;
}

// RLS (requests_visibility, 0002) does the scoping — a student sees their
// own, a holder sees what's on their desk, watchers see what they watch,
// dashboard grantees see their departments. No client-side filter needed
// or trusted here.
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

export interface SubmitRequestInput {
  categoryId: string;
  title: string;
  description?: string;
  firstHop?: string | null;
  travelScope?: 'internal' | 'outstation' | null;
  eventName?: string;
  organisedBy?: string;
  eventLocation?: string;
  startDate?: string | null;
  endDate?: string | null;
}

export async function submitRequest(input: SubmitRequestInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_and_submit_request', {
    p_category_id: input.categoryId,
    p_title: input.title,
    p_description: input.description ?? null,
    p_first_hop: input.firstHop ?? null,
    p_travel_scope: input.travelScope ?? null,
    p_event_name: input.eventName ?? null,
    p_organised_by: input.organisedBy ?? null,
    p_event_location: input.eventLocation ?? null,
    p_start_date: input.startDate || null,
    p_end_date: input.endDate || null,
  });
  if (error) throw error;
  return data as string;
}

export type DecisionAction = 'approved' | 'rejected' | 'changes_requested' | 'reviewed';

export async function decideRequest(requestId: string, action: DecisionAction, note?: string) {
  const { error } = await supabase.rpc('decide_request', {
    p_request_id: requestId,
    p_action: action,
    p_note: note ?? null,
  });
  if (error) throw error;
}

export async function forwardRequest(requestId: string, toUser: string, note?: string) {
  const { error } = await supabase.rpc('forward_request', {
    p_request_id: requestId,
    p_to_user: toUser,
    p_note: note ?? null,
  });
  if (error) throw error;
}

export interface ForwardTarget {
  user_id: string;
  full_name: string;
  email: string;
}

export async function searchForwardTargets(query: string): Promise<ForwardTarget[]> {
  const { data, error } = await supabase.rpc('search_forward_targets', { p_query: query });
  if (error) throw error;
  return (data ?? []) as ForwardTarget[];
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

// Internal comments are never returned to a student session — enforced by
// comments_visibility RLS plus a trigger that blocks base-level users from
// even authoring one (0002). This function just posts; it does not decide.
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
