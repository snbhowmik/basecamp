import { supabase } from './supabase';
import type { PendingAssignment, PriorityLevel, Tag, Department, Class } from '../types';

// Catalog reads — used to populate the invite form. RLS: priority_levels/
// tags/departments/classes are all readable by any authenticated user
// (0003_wizard_rls.sql), so these are plain selects, no special handling.

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

export async function listDepartments(): Promise<Department[]> {
  const { data, error } = await supabase.from('departments').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function listClasses(departmentId: string): Promise<Class[]> {
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .eq('department_id', departmentId)
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

export interface CreateInviteInput {
  email: string;
  levelId: string;
  tagCodes: string[];
  departmentId: string | null;
  classId: string | null;
  regNo: string | null;
  year: number | null;
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
      department_id: input.departmentId,
      class_id: input.classId,
      reg_no: input.regNo,
      year: input.year,
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
// (0008_invite_email.sql) because SECURITY DEFINER bypasses RLS.
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
// department/batch, no staff tags — enforced by
// pending_assignments_self_register in 0005), then signs them up.
// check_allowed_domain() finds that row and lets the signup through
// exactly as if an admin had invited them; apply_pending_assignment()
// grants the base level + creates student_profiles on the same trigger
// path as any other invite.
// ------------------------------------------------------------------

// Catalog reads for the PUBLIC registration form. These go through
// SECURITY DEFINER RPCs rather than selecting from departments/classes
// directly, because those tables' read policies require a session
// (0003_wizard_rls.sql) and a self-registering student doesn't have one
// yet — the direct select silently returns zero rows. See
// 0007_public_catalog.sql.
export interface PublicOption {
  id: string;
  name: string;
}

export async function listPublicDepartments(): Promise<PublicOption[]> {
  const { data, error } = await supabase.rpc('list_public_departments');
  if (error) throw error;
  return (data ?? []) as PublicOption[];
}

export async function listPublicBatches(departmentId: string): Promise<PublicOption[]> {
  const { data, error } = await supabase.rpc('list_public_batches', { p_department_id: departmentId });
  if (error) throw error;
  return (data ?? []) as PublicOption[];
}

export interface SelfRegisterInput {
  fullName: string;
  email: string;
  password: string;
  departmentId: string;
  classId: string | null;
  regNo: string;
}

export async function selfRegisterStudent(input: SelfRegisterInput) {
  const email = input.email.trim().toLowerCase();

  const levels = await listPriorityLevels();
  const baseLevel = levels[levels.length - 1]; // highest rank number = lowest authority
  if (!baseLevel) throw new Error('No priority levels configured yet — contact your administrator.');

  const { error: assignErr } = await supabase.from('pending_assignments').insert({
    email,
    level_id: baseLevel.id,
    tag_codes: [],
    department_id: input.departmentId,
    class_id: input.classId,
    reg_no: input.regNo.trim(),
    year: null,
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
    options: { data: { full_name: input.fullName } },
  });
  if (error) throw error;
  if (!data.user) throw new Error('Registration did not return a user.');
  return data.user;
}

// ------------------------------------------------------------------
// Staff/faculty invite acceptance — token-based, see get_invite_by_token()
// in 0005_public_registration.sql.
// ------------------------------------------------------------------

export interface InviteDetails {
  email: string;
  levelName: string;
  departmentName: string | null;
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
    departmentName: row.department_name,
    invitedByName: row.invited_by_name,
  };
}

export async function acceptInvite(email: string, fullName: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw error;
  if (!data.user) throw new Error('Signup did not return a user.');
  return data.user;
}
