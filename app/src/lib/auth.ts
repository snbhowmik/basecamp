import { supabase } from './supabase';
import type { Profile } from '../types';

export async function getCurrentProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  return data;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// True once the session has completed MFA (Supabase's aal2 claim). Sensitive
// actions require this — see PRD.md §7 and has_mfa() in 0002_functions_and_rls.sql.
export async function hasCompletedMfa(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  return data.currentLevel === 'aal2';
}

export interface SessionMfa {
  signedIn: boolean;
  aal2: boolean;
  /** The verified TOTP factor to challenge, or null if none is enrolled yet. */
  factorId: string | null;
}

// The gate App.tsx runs before anything else. It deliberately touches only
// GoTrue and the locally-held JWT — never PostgREST — because every PostgREST
// request now passes through require_mfa() (schema-v2/0016_require_mfa.sql)
// and would be refused at aal1, which is exactly the state this call exists to
// detect.
//
// factorId === null while signed in is a real state, not an error: signup and
// invite acceptance create the account before enrollment, and the database
// permits that window precisely so it can be closed. The caller must send
// those users to enroll rather than into the app.
export async function sessionMfa(): Promise<SessionMfa> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { signedIn: false, aal2: false, factorId: null };

  const { data: aal, error: aalErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalErr) throw aalErr;
  const { data: factors, error: factorsErr } = await supabase.auth.mfa.listFactors();
  if (factorsErr) throw factorsErr;

  return {
    signedIn: true,
    aal2: aal?.currentLevel === 'aal2',
    factorId: factors.totp.find((f) => f.status === 'verified')?.id ?? null,
  };
}
