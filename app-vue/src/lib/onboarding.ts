import { supabase } from './supabase';

// Registration, invite acceptance and TOTP enrolment — ported from
// app/src/lib/invites.ts and wizard.ts. Confirmation links return to /next/…
// so the Vue flow resumes itself (the React app's own links still go to /…).

export interface PublicOption { id: string; name: string }

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
  fullName: string; email: string; password: string;
  orgUnitId: string; batchId: string | null; regNo: string;
}

export async function selfRegisterStudent(input: SelfRegisterInput) {
  const email = input.email.trim().toLowerCase();

  // Resolved server-side: priority_levels is readable by `authenticated` only,
  // and a registering student has no session yet.
  const { data: baseLevelId, error: levelErr } = await supabase.rpc('public_base_level');
  if (levelErr) throw levelErr;
  if (!baseLevelId) throw new Error('No student level has been set up yet — contact your administrator.');

  const { error: assignErr } = await supabase.rpc('self_register', {
    p_email: email,
    p_org_unit_id: input.orgUnitId,
    p_batch_id: input.batchId,
    p_section_id: null,
    p_reg_no: input.regNo,
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
      // Explicit: do not let the link's destination depend on the Referer header.
      emailRedirectTo: `${window.location.origin}/next/register`,
    },
  });
  if (error) throw error;
  if (!data.user) throw new Error('Registration did not return a user.');
  return data.user;
}

export interface InviteDetails {
  email: string; levelName: string; orgUnitName: string | null; invitedByName: string | null;
}

export async function getInviteByToken(token: string): Promise<InviteDetails | null> {
  const { data, error } = await supabase.rpc('get_invite_by_token', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    email: row.email, levelName: row.level_name,
    orgUnitName: row.org_unit_name, invitedByName: row.invited_by_name,
  };
}

export async function acceptInvite(email: string, fullName: string, password: string, token: string) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${window.location.origin}/next/invite/${token}`,
    },
  });
  if (error) throw error;
  if (!data.user) throw new Error('Signup did not return a user.');
  return data.user;
}

export async function enrollTotp() {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
  if (error) throw error;
  return data; // { id, totp: { qr_code, secret, uri } }
}

export async function verifyTotp(factorId: string, code: string) {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) throw challenge.error;
  const verify = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
  if (verify.error) throw verify.error;
  return verify.data;
}
