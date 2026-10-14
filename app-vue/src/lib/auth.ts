import { supabase } from './supabase';

// Ported unchanged in behaviour from app/src/lib/auth.ts. The MFA freshness
// rule must match mfa_satisfied() in schema-v2/0024 (3600s): the database
// enforces it, this only decides when to ask politely.
export const MFA_MAX_AGE_SECONDS = 3600;

export function totpAgeSeconds(accessToken: string): number | null {
  try {
    const [, payload] = accessToken.split('.');
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    const stamps: number[] = (claims.amr ?? [])
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
  factorId: string | null;
  secondsUntilStale: number | null;
}

// Touches only GoTrue and the local JWT, never PostgREST: every PostgREST
// request passes through require_mfa() and is refused at aal1, which is the
// state this exists to detect.
export async function sessionMfa(): Promise<SessionMfa> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { signedIn: false, aal2: false, factorId: null, secondsUntilStale: null };

  const { data: aal, error: aalErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalErr) throw aalErr;
  const { data: factors, error: factorsErr } = await supabase.auth.mfa.listFactors();
  if (factorsErr) throw factorsErr;

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

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
