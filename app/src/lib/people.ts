import { supabase } from './supabase';

// People administration. Every call here is an RPC, never a table write:
// changing someone's level, scope or tags grants or revokes authority over
// other people's tickets, so the rules live in the database where they cannot
// be composed differently by a client.

export interface RoleAssignmentRow {
  id: string;
  user_id: string;
  level_id: string;
  org_unit_id: string | null;
  section_id: string | null;
  role_kind: string;
  is_primary: boolean;
  valid_until: string | null;
  priority_levels?: { name: string; rank: number } | null;
  org_units?: { name: string } | null;
}

export async function listRoleAssignments(userId: string): Promise<RoleAssignmentRow[]> {
  const { data, error } = await supabase
    .from('role_assignments')
    .select('*, priority_levels(name, rank), org_units(name)')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []) as RoleAssignmentRow[];
}

export async function assignRole(input: {
  userId: string;
  levelId: string;
  orgUnitId?: string | null;
  sectionId?: string | null;
  roleKind?: string;
  isPrimary?: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc('assign_role', {
    p_user_id: input.userId,
    p_level_id: input.levelId,
    p_org_unit_id: input.orgUnitId ?? null,
    p_section_id: input.sectionId ?? null,
    p_role_kind: input.roleKind ?? 'academic',
    p_is_primary: input.isPrimary ?? false,
  });
  if (error) throw error;
  return data as string;
}

// Replaces the person's tags with exactly this set. The 'admin' tag is refused
// by the database in both directions — it is not a label, it is the captaincy.
export async function setUserTags(userId: string, codes: string[]): Promise<void> {
  const { error } = await supabase.rpc('set_user_tags', { p_user_id: userId, p_codes: codes });
  if (error) throw error;
}

export async function updateMemberProfile(input: {
  userId: string;
  orgUnitId?: string | null;
  batchId?: string | null;
  sectionId?: string | null;
  regNo?: string | null;
  fetId?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('update_member_profile', {
    p_user_id: input.userId,
    p_org_unit_id: input.orgUnitId ?? null,
    p_batch_id: input.batchId ?? null,
    p_section_id: input.sectionId ?? null,
    p_reg_no: input.regNo ?? null,
    p_fet_id: input.fetId ?? null,
  });
  if (error) throw error;
}

// Suspension, not deletion. profiles is referenced from tickets, signatures and
// history, so removing a person would rewrite the record of what they did.
export async function setAccountActive(userId: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_account_active', { p_user_id: userId, p_active: active });
  if (error) throw error;
}
