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

// How long an authenticator check stands for before the app asks again. Must
// match the 3600 in mfa_satisfied() (schema-v2/0024) — the database is what
// enforces this; the value here only decides when to ask politely rather than
// letting a request be refused.
export const MFA_MAX_AGE_SECONDS = 3600;

// Seconds since this session last verified a TOTP code, read from the `amr`
// claim GoTrue stamps into the access token. Null when the claim is missing.
//
// This is needed because aal2 is *sticky*: GoTrue carries it across every
// refresh-token rotation, so getAuthenticatorAssuranceLevel() keeps saying
// aal2 indefinitely. A session observed here on 2026-08-24 held an `amr` totp
// timestamp 85 hours older than the token carrying it.
export function totpAgeSeconds(accessToken: string): number | null {
  try {
    const [, payload] = accessToken.split('.');
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    const stamps = (claims.amr ?? [])
      .filter((e: { method?: string }) => e.method === 'totp')
      .map((e: { timestamp: number }) => e.timestamp);
    if (stamps.length === 0) return null;
    return Math.floor(Date.now() / 1000) - Math.max(...stamps);
  } catch {
    return null;
  }
}

export interface SessionMfa {
  signedIn: boolean;
  aal2: boolean;
  /** The verified TOTP factor to challenge, or null if none is enrolled yet. */
  factorId: string | null;
  /** Seconds until the MFA assertion goes stale, or null if it already has. */
  secondsUntilStale: number | null;
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
  if (!session) return { signedIn: false, aal2: false, factorId: null, secondsUntilStale: null };

  const { data: aal, error: aalErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalErr) throw aalErr;
  const { data: factors, error: factorsErr } = await supabase.auth.mfa.listFactors();
  if (factorsErr) throw factorsErr;

  // An hour-old aal2 is aal1 as far as this app is concerned, and saying so
  // here routes the user to the same VerifyMfa screen a fresh login uses.
  // Without this the claim still reads aal2, the gate waves them through, and
  // the first PostgREST call fails with a raw permission error instead.
  const age = totpAgeSeconds(session.access_token);
  const claimAal2 = aal?.currentLevel === 'aal2';
  const fresh = age !== null && age < MFA_MAX_AGE_SECONDS;

  return {
    signedIn: true,
    aal2: claimAal2 && fresh,
    factorId: factors.totp.find((f) => f.status === 'verified')?.id ?? null,
    secondsUntilStale: claimAal2 && fresh ? MFA_MAX_AGE_SECONDS - (age as number) : null,
  };
}
