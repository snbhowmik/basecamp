import { supabase } from './supabase';

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

export async function updateProfile(fields: { full_name?: string; phone?: string | null }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');
  const { error } = await supabase.from('profiles').update(fields).eq('id', user.id);
  if (error) throw error;
}

export async function changePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export interface StudentDetails {
  reg_no: string;
  year: number;
  department_id: string;
  class_id: string | null;
  is_complete: boolean;
  departments?: { name: string } | null;
  classes?: { name: string } | null;
}

export async function getStudentDetails(userId: string): Promise<StudentDetails | null> {
  const { data, error } = await supabase
    .from('student_profiles')
    .select('*, departments(name), classes(name)')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as StudentDetails | null;
}
