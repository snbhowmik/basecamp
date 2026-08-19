import { supabase } from './supabase';
import type {
  PendingAssignment, PriorityLevel, Tag, OrgUnit, Batch, Section, MemberType, RoleKind,
} from '../types';

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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const { data, error } = await supabase
    .from('pending_assignments')
    .insert({
      email: input.email.trim().toLowerCase(),
      level_id: input.levelId,
      tag_codes: input.tagCodes,
      member_type: input.memberType,
      role_kind: input.roleKind,
      org_unit_id: input.orgUnitId,
      batch_id: input.batchId,
      section_id: input.sectionId,
      reg_no: input.regNo,
      fet_id: input.fetId,
      invited_by: user.id,
    })
    .select()
    .single();
  // RLS (can_invite()) is the real gate — a rejected insert surfaces here as
  // a generic 42501 from PostgREST; the caller decides how to present it.
  if (error) throw error;
  return data;
}

export async function revokeInvite(id: string) {
  const { error } = await supabase.from('pending_assignments').delete().eq('id', id);
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

// ------------------------------------------------------------------
// Public student self-registration — no session required. Creates the
// registrant's own pending_assignments row (base level, their chosen
// org unit/batch, no staff tags — enforced by RLS), then signs them up.
// check_allowed_domain() finds that row and lets the signup through
// exactly as if an admin had invited them; apply_pending_assignment()
// grants the base level + creates member_profiles on the same trigger
// path as any other invite.
// ------------------------------------------------------------------

// Catalog reads for the PUBLIC registration form. These go through
// SECURITY DEFINER RPCs rather than selecting from org_units/batches
// directly, because those tables' read policies require a session and a
// self-registering student doesn't have one yet — the direct select silently
// returns zero rows.
export interface PublicOption {
  id: string;
  name: string;
}

export async function listPublicOrgUnits(): Promise<PublicOption[]> {
  const { data, error } = await supabase.rpc('list_public_org_units');
  if (error) throw error;
  return (data ?? []) as PublicOption[];
}

export async function listPublicBatches(orgUnitId: string): Promise<PublicOption[]> {
  const { data, error } = await supabase.rpc('list_public_batches', { p_org_unit_id: orgUnitId });
  if (error) throw error;
  return (data ?? []) as PublicOption[];
}

export interface SelfRegisterInput {
  fullName: string;
  email: string;
  password: string;
  orgUnitId: string;
  batchId: string | null;
  sectionId: string | null;
  regNo: string;
}

export async function selfRegisterStudent(input: SelfRegisterInput) {
  const email = input.email.trim().toLowerCase();

  // Prefer the level explicitly flagged is_base; fall back to the highest
  // rank number (lowest authority) only if nobody has flagged one.
  const levels = await listPriorityLevels();
  const baseLevel = levels.find((l) => l.is_base) ?? levels[levels.length - 1];
  if (!baseLevel) throw new Error('No priority levels configured yet — contact your administrator.');

  const { error: assignErr } = await supabase.from('pending_assignments').insert({
    email,
    level_id: baseLevel.id,
    tag_codes: [],
    member_type: 'student',
    role_kind: 'academic',
    org_unit_id: input.orgUnitId,
    batch_id: input.batchId,
    section_id: input.sectionId,
    reg_no: input.regNo.trim(),
  });
  if (assignErr) {
    if (assignErr.code === '23505') {
      throw new Error('An open registration already exists for this email. Contact your administrator.');
    }
    throw assignErr;
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: {
      data: { full_name: input.fullName },
      // Explicit for the same reason as acceptInvite: do not let the
      // confirmation link's destination depend on the Referer header.
      emailRedirectTo: `${window.location.origin}/register`,
    },
  });
  if (error) throw error;
  if (!data.user) throw new Error('Registration did not return a user.');
  return data.user;
}

// ------------------------------------------------------------------
// Staff/faculty invite acceptance — token-based, see get_invite_by_token()
// in schema-v2/0004_bootstrap_invites_rpcs.sql.
// ------------------------------------------------------------------

export interface InviteDetails {
  email: string;
  levelName: string;
  orgUnitName: string | null;
  invitedByName: string | null;
}

export async function getInviteByToken(token: string): Promise<InviteDetails | null> {
  const { data, error } = await supabase.rpc('get_invite_by_token', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    email: row.email,
    levelName: row.level_name,
    orgUnitName: row.org_unit_name,
    invitedByName: row.invited_by_name,
  };
}

// emailRedirectTo is set explicitly. Left unset, GoTrue falls back to the
// Referer header to decide where its confirmation link returns to — which
// happens to work until a browser or privacy setting strips Referer, and is
// invisible when it breaks. Point it at the invite page deliberately: that is
// where MFA enrollment continues.
export async function acceptInvite(
  email: string, fullName: string, password: string, token: string,
) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: inviteLink(token),
    },
  });
  if (error) throw error;
  if (!data.user) throw new Error('Signup did not return a user.');
  return data.user;
}
