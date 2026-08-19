import { supabase } from './supabase';
import type { MemberType } from '../types';

// Account self-service. MFA re-enrollment here covers the "I still have my
// session but lost/changed my authenticator app" case — the user proves
// possession of the OLD factor implicitly by holding an aal2 session, then
// swaps in a new one.
//
// It deliberately does NOT cover "I'm locked out and can't sign in at all".
// That needs an out-of-band reset by someone with elevated access, which in
// this architecture means the service_role key — never available to the
// browser (SECURITY.md R-12). Tracked in TASK.md as still open.

export interface MfaFactorSummary {
  id: string;
  friendlyName: string | null;
  status: string;
  createdAt: string;
}

export async function listMfaFactors(): Promise<MfaFactorSummary[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return (data.totp ?? []).map((f) => ({
    id: f.id,
    friendlyName: f.friendly_name ?? null,
    status: f.status,
    createdAt: f.created_at,
  }));
}

export async function beginMfaReenroll() {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `authenticator-${Date.now()}`,
  });
  if (error) throw error;
  return data;
}

export async function confirmMfaReenroll(newFactorId: string, code: string, oldFactorIds: string[]) {
  const challenge = await supabase.auth.mfa.challenge({ factorId: newFactorId });
  if (challenge.error) throw challenge.error;

  const verify = await supabase.auth.mfa.verify({
    factorId: newFactorId,
    challengeId: challenge.data.id,
    code,
  });
  if (verify.error) throw verify.error;

  // Only drop the old factors once the new one is verified — doing it in the
  // other order would leave the account with no working factor if the user
  // mistypes the code.
  for (const id of oldFactorIds) {
    if (id === newFactorId) continue;
    await supabase.auth.mfa.unenroll({ factorId: id });
  }
}

export async function cancelMfaEnroll(factorId: string) {
  await supabase.auth.mfa.unenroll({ factorId });
}

// v2's profiles table has no phone column — full_name is the only
// self-editable field left here.
export async function updateProfile(fields: { full_name?: string }) {
  const { error } = await supabase.rpc('update_own_profile', { p_full_name: fields.full_name ?? '' });
  if (error) throw error;
}

export async function changePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// v2 folded students and staff into member_profiles, discriminated by
// member_type. A student carries reg_no + batch/section; a staff member
// carries fet_id. Both hang off the same org_unit.
export interface MemberDetails {
  user_id: string;
  member_type: MemberType;
  reg_no: string | null;
  fet_id: string | null;
  org_unit_id: string | null;
  batch_id: string | null;
  section_id: string | null;
  cgpa: number | null;
  cgpa_verified_at: string | null;
  is_complete: boolean;
  org_units?: { name: string } | null;
  batches?: { name: string } | null;
  sections?: { name: string } | null;
}

export async function getMemberDetails(userId: string): Promise<MemberDetails | null> {
  const { data, error } = await supabase
    .from('member_profiles')
    .select('*, org_units(name), batches(name), sections(name)')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as MemberDetails | null;
}

// The person card behind PRD-V2 §9 — one round trip, already joined and
// counted server-side.
export interface MemberCard {
  user_id: string;
  full_name: string;
  reg_no: string | null;
  fet_id: string | null;
  org_unit_name: string | null;
  batch_name: string | null;
  section_name: string | null;
  tech_count: number;
  non_tech_count: number;
}

export async function getMemberCard(userId: string): Promise<MemberCard | null> {
  const { data, error } = await supabase.rpc('get_member_card', { p_user_id: userId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as MemberCard | null;
}
