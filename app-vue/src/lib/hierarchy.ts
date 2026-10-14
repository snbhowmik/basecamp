import { supabase } from './supabase';
import type { Batch, OrgUnit, PriorityLevel, Profile, Section } from './types';

// The org board — who holds which rung, and over what.
//
// Everything here is a read. Authority is decided by RLS and by
// assignment_is_current() in the database; this module only draws what the
// caller is already allowed to see, so a Dean and a Mentor loading the same
// board get different rows back without the frontend filtering anything.
//
// The board is split in two on purpose. Positions (Captain → Dean → HOD →
// Mentor) come from role_assignments and are small enough to hold in memory.
// Students come from member_profiles a window at a time, because a real
// deployment has 8,000+ of them and no screen needs them all resident to draw
// one column.

export interface Position {
  userId: string;
  fullName: string;
  email: string;
  isActive: boolean;
  levelId: string;
  orgUnitId: string | null;
  sectionId: string | null;
  isPrimary: boolean;
}

export interface StudentRow {
  userId: string;
  fullName: string;
  email: string;
  regNo: string | null;
  orgUnitId: string | null;
  sectionId: string | null;
  isActive: boolean;
}

export interface HierarchySnapshot {
  levels: PriorityLevel[];
  orgUnits: OrgUnit[];
  batches: Batch[];
  sections: Section[];
  positions: Position[];
}

// A person's reach: the org unit they hold, plus everything under it. A Dean
// assigned to a faculty covers every programme inside it, so filtering the
// column to their right means "org_unit_id in this set", not "== this id".
export function descendantOrgUnits(orgUnits: OrgUnit[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const u of orgUnits) {
    if (!u.parent_id) continue;
    childrenOf.set(u.parent_id, [...(childrenOf.get(u.parent_id) ?? []), u.id]);
  }
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const child of childrenOf.get(id) ?? []) walk(child);
  };
  walk(rootId);
  return out;
}

export async function loadHierarchy(): Promise<HierarchySnapshot> {
  const [levelsRes, unitsRes, batchesRes, sectionsRes, rolesRes] = await Promise.all([
    supabase.from('priority_levels').select('*').eq('is_active', true).order('rank'),
    supabase.from('org_units').select('*').order('name'),
    supabase.from('batches').select('*').order('start_year', { ascending: false }),
    supabase.from('sections').select('*').order('name'),
    supabase
      .from('role_assignments')
      .select('user_id, level_id, org_unit_id, section_id, is_primary, valid_until')
      .order('is_primary', { ascending: false }),
  ]);
  if (levelsRes.error) throw levelsRes.error;
  if (unitsRes.error) throw unitsRes.error;
  if (batchesRes.error) throw batchesRes.error;
  if (sectionsRes.error) throw sectionsRes.error;
  if (rolesRes.error) throw rolesRes.error;

  type RoleRow = {
    user_id: string;
    level_id: string;
    org_unit_id: string | null;
    section_id: string | null;
    is_primary: boolean;
    valid_until: string | null;
  };

  // Expired assignments are dropped for display only. An assignment that has
  // lapsed is not a position somebody still holds, and showing it on a board
  // titled "who reports to whom" would be a lie about current authority.
  const now = Date.now();
  const roles = (rolesRes.data ?? []).filter(
    (r: RoleRow) => !r.valid_until || Date.parse(r.valid_until) >= now,
  ) as RoleRow[];

  const userIds = [...new Set(roles.map((r) => r.user_id))];
  const profiles = new Map<string, Profile>();
  if (userIds.length > 0) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, is_active')
      .in('id', userIds);
    if (error) throw error;
    for (const p of (data ?? []) as Profile[]) profiles.set(p.id, p);
  }

  const positions: Position[] = [];
  for (const r of roles) {
    const p = profiles.get(r.user_id);
    // A role_assignment whose profile did not come back is one RLS hid from
    // this viewer. Skipping it is correct — drawing a nameless node would
    // leak that somebody exists there.
    if (!p) continue;
    positions.push({
      userId: r.user_id,
      fullName: p.full_name,
      email: p.email,
      isActive: p.is_active,
      levelId: r.level_id,
      orgUnitId: r.org_unit_id,
      sectionId: r.section_id,
      isPrimary: r.is_primary,
    });
  }

  return {
    levels: (levelsRes.data ?? []) as PriorityLevel[],
    orgUnits: (unitsRes.data ?? []) as OrgUnit[],
    batches: (batchesRes.data ?? []) as Batch[],
    sections: (sectionsRes.data ?? []) as Section[],
    positions,
  };
}

// What slice of the student body a column is showing. Null means unscoped —
// nobody upstream is selected, so the column is the whole cohort the viewer
// can see.
export interface StudentScope {
  orgUnitIds: string[] | null;
  sectionId: string | null;
}

function studentQuery(scope: StudentScope) {
  let q = supabase.from('member_profiles').select(
    'user_id, reg_no, org_unit_id, section_id, profiles!member_profiles_user_id_fkey!inner(full_name, email, is_active)',
    { count: 'exact' },
  ).eq('member_type', 'student');

  if (scope.sectionId) q = q.eq('section_id', scope.sectionId);
  else if (scope.orgUnitIds) q = q.in('org_unit_id', scope.orgUnitIds);
  return q;
}

export async function countStudents(scope: StudentScope): Promise<number> {
  const { count, error } = await studentQuery(scope).range(0, 0);
  if (error) throw error;
  return count ?? 0;
}

// One window of the cohort. Ordered by register number rather than name
// because that is the order a register is actually kept in, and because
// PostgREST cannot sort a parent row by an embedded column — ordering on
// full_name here would silently not apply, and the pages would overlap.
export async function fetchStudentPage(
  scope: StudentScope,
  from: number,
  to: number,
): Promise<{ rows: StudentRow[]; total: number }> {
  const { data, count, error } = await studentQuery(scope)
    .order('reg_no', { nullsFirst: false })
    .range(from, to);
  if (error) throw error;

  type Row = {
    user_id: string;
    reg_no: string | null;
    org_unit_id: string | null;
    section_id: string | null;
    profiles: { full_name: string; email: string; is_active: boolean }
      | { full_name: string; email: string; is_active: boolean }[]
      | null;
  };

  const rows = ((data ?? []) as Row[]).map((r) => {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    return {
      userId: r.user_id,
      fullName: p?.full_name ?? '—',
      email: p?.email ?? '',
      regNo: r.reg_no,
      orgUnitId: r.org_unit_id,
      sectionId: r.section_id,
      isActive: p?.is_active ?? true,
    };
  });

  return { rows, total: count ?? rows.length };
}

// ── Directory search ──────────────────────────────────────────────────────
//
// Two questions wear the same clothes here. "RA2411026050147" is a lookup;
// "Computer Science, III-B" is a browse with no text in it at all. Both go to
// search_people(), which treats an empty query as "no text filter" rather than
// "match nothing" — see schema-v2/0022.
//
// This is the one read on this page that does NOT go through RLS: the function
// is SECURITY DEFINER, so it carries its own guard (a real subject, MFA
// satisfied) and its own EXECUTE grant. schema-v2/0021 has the history of why
// that matters.

export type MemberType = 'staff' | 'student';

export interface PeopleFilter {
  query: string;
  memberType: MemberType | null;
  orgUnitId: string | null;
  batchId: string | null;
  sectionId: string | null;
  levelId: string | null;
}

export interface PersonResult {
  userId: string;
  fullName: string;
  email: string;
  regNo: string | null;
  fetId: string | null;
  memberType: string | null;
  orgUnitName: string | null;
  batchName: string | null;
  sectionName: string | null;
  levelName: string | null;
}

export const EMPTY_FILTER: PeopleFilter = {
  query: '', memberType: null, orgUnitId: null, batchId: null, sectionId: null, levelId: null,
};

// A filter with nothing set would ask the server for the entire directory, so
// the caller uses this to decide whether to search at all.
export function filterIsEmpty(f: PeopleFilter): boolean {
  return f.query.trim() === '' && !f.memberType && !f.orgUnitId
    && !f.batchId && !f.sectionId && !f.levelId;
}

export async function searchPeople(
  f: PeopleFilter,
  limit = 25,
  offset = 0,
): Promise<{ rows: PersonResult[]; total: number }> {
  const { data, error } = await supabase.rpc('search_people', {
    p_query: f.query.trim(),
    p_member_type: f.memberType,
    p_org_unit_id: f.orgUnitId,
    p_section_id: f.sectionId,
    p_batch_id: f.batchId,
    p_level_id: f.levelId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;

  type Row = {
    user_id: string; full_name: string; email: string;
    reg_no: string | null; fet_id: string | null; member_type: string | null;
    org_unit_name: string | null; batch_name: string | null;
    section_name: string | null; level_name: string | null;
    total_count: number;
  };

  const rows = (data ?? []) as Row[];
  return {
    rows: rows.map((r) => ({
      userId: r.user_id,
      fullName: r.full_name,
      email: r.email,
      regNo: r.reg_no,
      fetId: r.fet_id,
      memberType: r.member_type,
      orgUnitName: r.org_unit_name,
      batchName: r.batch_name,
      sectionName: r.section_name,
      levelName: r.level_name,
    })),
    // total_count is a window aggregate, so it is the size of the whole match,
    // not of this page. An empty page means an empty match.
    total: rows[0]?.total_count ?? 0,
  };
}
