import { supabase } from './supabase';
import type { Department, Class, RequestType, RequestCategory, Profile } from '../types';

// Departments and batches. Creation goes through the RPCs in
// 0006_requests_and_org.sql rather than direct inserts, because each one
// also has to create the scope tag that is_hod_of()/is_mentor_of() resolve
// through — two client-side inserts would leave orphans on partial failure.

export async function listDepartments(): Promise<Department[]> {
  const { data, error } = await supabase.from('departments').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createDepartment(name: string, code: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_department', { p_name: name, p_code: code });
  if (error) throw error;
  return data as string;
}

export async function listAllBatches(): Promise<Class[]> {
  const { data, error } = await supabase.from('classes').select('*').order('year', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createBatch(departmentId: string, name: string, year: number): Promise<string> {
  const { data, error } = await supabase.rpc('create_batch', {
    p_department_id: departmentId,
    p_name: name,
    p_year: year,
  });
  if (error) throw error;
  return data as string;
}

// ------------------------------------------------------------------
// Request taxonomy — the "Workflow" page. Categories form a tree
// (request_categories.parent_id), unbounded depth, all admin-editable
// without a deploy (PRD §8.2).
// ------------------------------------------------------------------

export async function listRequestTypes(): Promise<RequestType[]> {
  const { data, error } = await supabase.from('request_types').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function listCategories(): Promise<RequestCategory[]> {
  const { data, error } = await supabase
    .from('request_categories')
    .select('*')
    .order('sort_order')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createRequestType(code: string, name: string) {
  const { error } = await supabase.from('request_types').insert({ code: code.trim().toLowerCase(), name: name.trim() });
  if (error) throw error;
}

export interface CreateCategoryInput {
  requestTypeId: string;
  parentId: string | null;
  code: string;
  name: string;
  decisionMode: 'approval' | 'log_only';
  retainAttachments: boolean;
}

export async function createCategory(input: CreateCategoryInput) {
  const { error } = await supabase.from('request_categories').insert({
    request_type_id: input.requestTypeId,
    parent_id: input.parentId,
    code: input.code.trim().toLowerCase(),
    name: input.name.trim(),
    decision_mode: input.decisionMode,
    retain_attachments_after_close: input.retainAttachments,
  });
  if (error) throw error;
}

export async function setCategoryActive(id: string, isActive: boolean) {
  const { error } = await supabase.from('request_categories').update({ is_active: isActive }).eq('id', id);
  if (error) throw error;
}

export interface FirstHopOption {
  id: string;
  category_id: string;
  label: string;
  resolve_tag: string;
  is_default: boolean;
  sort_order: number;
}

export async function listFirstHopOptions(categoryId: string): Promise<FirstHopOption[]> {
  const { data, error } = await supabase
    .from('category_first_hop_options')
    .select('*')
    .eq('category_id', categoryId)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

export async function createFirstHopOption(categoryId: string, label: string, resolveTag: string) {
  const { error } = await supabase.from('category_first_hop_options').insert({
    category_id: categoryId,
    label: label.trim(),
    resolve_tag: resolveTag.trim(),
  });
  if (error) throw error;
}

export async function deleteFirstHopOption(id: string) {
  const { error } = await supabase.from('category_first_hop_options').delete().eq('id', id);
  if (error) throw error;
}

// ------------------------------------------------------------------
// Accounts overview (captain). profiles_read_staff in 0002 lets any
// non-base-level user read profiles, so this is a plain select.
// ------------------------------------------------------------------

export interface AccountRow extends Profile {
  levelName: string | null;
  tags: string[];
}

export async function listAccounts(): Promise<AccountRow[]> {
  const [profilesRes, levelsRes, tagsRes] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    supabase.from('user_levels').select('user_id, priority_levels(name)'),
    supabase.from('user_tags').select('user_id, tags(code)'),
  ]);
  if (profilesRes.error) throw profilesRes.error;

  const levelByUser = new Map<string, string>();
  for (const row of levelsRes.data ?? []) {
    const r = row as { user_id: string; priority_levels: { name: string } | { name: string }[] | null };
    const lvl = Array.isArray(r.priority_levels) ? r.priority_levels[0] : r.priority_levels;
    if (lvl) levelByUser.set(r.user_id, lvl.name);
  }

  const tagsByUser = new Map<string, string[]>();
  for (const row of tagsRes.data ?? []) {
    const r = row as { user_id: string; tags: { code: string } | { code: string }[] | null };
    const t = Array.isArray(r.tags) ? r.tags : r.tags ? [r.tags] : [];
    tagsByUser.set(r.user_id, [...(tagsByUser.get(r.user_id) ?? []), ...t.map((x) => x.code)]);
  }

  return (profilesRes.data ?? []).map((p: Profile) => ({
    ...p,
    levelName: levelByUser.get(p.id) ?? null,
    tags: tagsByUser.get(p.id) ?? [],
  }));
}
