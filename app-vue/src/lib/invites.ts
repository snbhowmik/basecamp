import { supabase } from './supabase';
import type {
  PendingAssignment, PriorityLevel, Tag, OrgUnit, Batch, Section, MemberType, RoleKind,
} from './types';

// Catalog reads — used to populate the invite form. RLS: priority_levels/
// tags/org_units/batches are all readable by any authenticated user, so these
// are plain selects, no special handling.

export async function listPriorityLevels(): Promise<PriorityLevel[]> {
  const { data, error } = await supabase.from('priority_levels').select('*').order('rank');
  if (error) throw error;
  return data ?? [];
}

export async function listTags(): Promise<Tag[]> {
  const { data, error } = await supabase.from('tags').select('*').order('label');
  if (error) throw error;
  return data ?? [];
}

export async function listOrgUnits(): Promise<OrgUnit[]> {
  const { data, error } = await supabase.from('org_units').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function listBatches(orgUnitId: string): Promise<Batch[]> {
  const { data, error } = await supabase
    .from('batches')
    .select('*')
    .eq('org_unit_id', orgUnitId)
    .order('start_year', { ascending: false });
  if (error) throw error;
  return data ?? [];
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

export async function listMyInvites(): Promise<PendingAssignment[]> {
  const { data, error } = await supabase
    .from('pending_assignments')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// v2: an invite declares what kind of member this will be. A student needs
// reg_no, a staff member needs fet_id — member_profiles enforces that pairing
// with a check constraint, so a mismatched invite fails at signup, not here.
export interface CreateInviteInput {
  email: string;
  levelId: string;
  tagCodes: string[];
  memberType: MemberType;
  roleKind: RoleKind;
  orgUnitId: string | null;
  batchId: string | null;
  sectionId: string | null;
  regNo: string | null;
  fetId: string | null;
}

export async function createInvite(input: CreateInviteInput): Promise<PendingAssignment> {
  // can_invite() is re-checked inside create_invite(); a refusal comes back as
  // a sentence rather than a bare 42501 from PostgREST.
  const { data, error } = await supabase.rpc('create_invite', {
    p_email: input.email.trim().toLowerCase(),
    p_level_id: input.levelId,
    p_tag_codes: input.tagCodes,
    p_member_type: input.memberType,
    p_role_kind: input.roleKind,
    p_org_unit_id: input.orgUnitId,
    p_batch_id: input.batchId,
    p_section_id: input.sectionId,
    p_reg_no: input.regNo,
    p_fet_id: input.fetId,
  });
  if (error) throw error;
  return data as PendingAssignment;
}

// Withdrawing an invite is a deletion, so it needs a fresh authenticator code
// like any other — see ConfirmDestructive.
export async function revokeInvite(id: string) {
  const { error } = await supabase.rpc('revoke_invite', { p_id: id });
  if (error) throw error;
}

// Clears the sent stamp so the mailer worker picks the row up again on its
// next poll. Authorization is re-checked inside resend_invite_email()
// because SECURITY DEFINER bypasses RLS.
export async function resendInviteEmail(id: string) {
  const { error } = await supabase.rpc('resend_invite_email', { p_id: id });
  if (error) throw error;
}

export function inviteLink(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}
