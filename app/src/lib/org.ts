import { supabase } from './supabase';
import { adminDelete } from './admin';
import type { OrgUnit, OrgUnitType, Batch, Section, RequestType, RequestCategory, Profile } from '../types';

// The org tree: org_units (faculty → programme) → batches → sections.
// Creation goes through the RPCs in schema-v2/0005_org_rpcs.sql rather than
// direct inserts, because an org unit also has to create the scope tag that
// the relationship checks resolve through — two client-side inserts would
// leave orphans on partial failure.

export async function listOrgUnits(): Promise<OrgUnit[]> {
  const { data, error } = await supabase.from('org_units').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createOrgUnit(
  name: string,
  code: string,
  unitType: OrgUnitType,
  parentId: string | null = null,
  campus: string | null = null,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_org_unit', {
    p_name: name ?? null,
    p_code: code,
    p_unit_type: unitType,
    p_parent_id: parentId,
    p_campus: campus,
  });
  if (error) throw error;
  return data as string;
}

// Renames go through functions rather than table updates: the browser asks for
// an outcome and the database decides, instead of composing its own UPDATE.
export async function renameOrgUnit(id: string, name: string): Promise<void> {
  const { error } = await supabase.rpc('rename_org_unit', { p_id: id, p_name: name });
  if (error) throw error;
}

export async function renameRequestType(id: string, name: string): Promise<void> {
  const { error } = await supabase.rpc('rename_request_type', { p_id: id, p_name: name });
  if (error) throw error;
}

export async function renameCategory(id: string, name: string): Promise<void> {
  const { error } = await supabase.rpc('rename_category', { p_id: id, p_name: name });
  if (error) throw error;
}

export async function listAllBatches(): Promise<Batch[]> {
  const { data, error } = await supabase
    .from('batches')
    .select('*')
    .order('start_year', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// v2 batches span a range (start_year..end_year) rather than carrying a single
// `year`, and an optional reg_no_prefix that reg_no_matches_batch() validates
// self-registering students against (PRD-V2 §8.2).
// `name` is optional: passed empty, create_batch() derives "<start>-<end>".
// The years are the structured half — reg-no validation and intake queries need
// them — so asking for the name as well was the same fact typed twice.
export async function createBatch(
  orgUnitId: string,
  name: string | null,
  startYear: number,
  endYear: number,
  mode = 'FT',
  regNoPrefix: string | null = null,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_batch', {
    p_org_unit_id: orgUnitId,
    p_name: name ?? null,
    p_start_year: startYear,
    p_end_year: endYear,
    p_mode: mode,
    p_reg_no_prefix: regNoPrefix,
  });
  if (error) throw error;
  return data as string;
}

export async function listSections(batchId: string): Promise<Section[]> {
  const { data, error } = await supabase
    .from('sections')
    .select('*')
    .eq('batch_id', batchId)
    .order('name');
  if (error) throw error;
  return data ?? [];
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

// decision_mode moved from request_categories onto the type in v2 — every
// category under a type shares its mode.
export async function createRequestType(
  code: string,
  name: string,
  decisionMode: 'approval' | 'log_only' = 'approval',
) {
  const { error } = await supabase.rpc('create_request_type', {
    p_code: code, p_name: name, p_decision_mode: decisionMode,
  });
  if (error) throw error;
}

export interface CreateCategoryInput {
  requestTypeId: string;
  parentId: string | null;
  name: string;
  classification: 'tech' | 'non_tech' | null;
  retainAttachments: boolean;
}

export async function createCategory(input: CreateCategoryInput) {
  const { error } = await supabase.rpc('create_category', {
    p_request_type_id: input.requestTypeId,
    p_parent_id: input.parentId,
    p_name: input.name,
    p_classification: input.classification,
    p_retain: input.retainAttachments,
  });
  if (error) throw error;
}

export async function setCategoryActive(id: string, isActive: boolean) {
  const { error } = await supabase.rpc('set_category_active', { p_id: id, p_active: isActive });
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
  const { error } = await supabase.rpc('create_first_hop_option', {
    p_category_id: categoryId, p_label: label, p_resolve_tag: resolveTag,
  });
  if (error) throw error;
}

// Routed through admin_delete(): category_first_hop_options no longer carries a
// delete policy, so a direct .delete() here removed nothing and reported
// success — the option stayed on screen after a reload.
export async function deleteFirstHopOption(id: string) {
  await adminDelete('category_first_hop_options', id);
}

// ------------------------------------------------------------------
// Accounts overview (captain). The profiles read policy lets any
// non-lowest-level user read profiles, so this is a plain select.
// ------------------------------------------------------------------

export interface AccountRow extends Profile {
  levelNames: string[];
  tags: string[];
}

export async function listAccounts(): Promise<AccountRow[]> {
  const [profilesRes, levelsRes, tagsRes] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    // v2: several assignments per user, so this is a list, not a lookup.
    // Expired assignments are excluded here for display only — authority is
    // decided by assignment_is_current() in the database, never by this.
    supabase
      .from('role_assignments')
      .select('user_id, valid_until, is_primary, priority_levels(name)')
      .order('is_primary', { ascending: false }),
    supabase.from('user_tags').select('user_id, tags(code)'),
  ]);
  if (profilesRes.error) throw profilesRes.error;

  const now = Date.now();
  const levelsByUser = new Map<string, string[]>();
  for (const row of levelsRes.data ?? []) {
    const r = row as {
      user_id: string;
      valid_until: string | null;
      priority_levels: { name: string } | { name: string }[] | null;
    };
    if (r.valid_until && Date.parse(r.valid_until) < now) continue;
    const lvl = Array.isArray(r.priority_levels) ? r.priority_levels[0] : r.priority_levels;
    if (lvl) levelsByUser.set(r.user_id, [...(levelsByUser.get(r.user_id) ?? []), lvl.name]);
  }

  const tagsByUser = new Map<string, string[]>();
  for (const row of tagsRes.data ?? []) {
    const r = row as { user_id: string; tags: { code: string } | { code: string }[] | null };
    const t = Array.isArray(r.tags) ? r.tags : r.tags ? [r.tags] : [];
    tagsByUser.set(r.user_id, [...(tagsByUser.get(r.user_id) ?? []), ...t.map((x) => x.code)]);
  }

  return (profilesRes.data ?? []).map((p: Profile) => ({
    ...p,
    levelNames: levelsByUser.get(p.id) ?? [],
    tags: tagsByUser.get(p.id) ?? [],
  }));
}
