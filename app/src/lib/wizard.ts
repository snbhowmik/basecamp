import { supabase } from './supabase';

// First-boot setup wizard, per PRD.md §5.
//
// The wizard creates exactly one account: the captain. It does three things
// and stops — captain account, MFA, allowed domains.
//
// It deliberately does NOT create priority levels. v1 shipped a prefilled
// Dean/HOD/Coordinator/Mentor/Student ladder here, which is fixture data by
// another name and wrong for any organisation that is not this one. Levels are
// built by the captain from the dashboard afterwards (components/setup/
// LevelsSetup.tsx), where they hold a real session.
//
// The captain is identified by the `admin` tag *code* (kept as-is, not renamed
// to 'captain', because has_tag('admin') is load-bearing throughout
// schema-v2/0003_rls.sql). That tag is granted by setup_levels(), not here — it
// is the write that closes the bootstrap window, so it must come last.
//
// Bootstrap ordering note: this INVERTED in v2. In v1 `allowed_login_domains`
// had no admin-only RLS, so the wizard could insert the captain's domain as
// anon before signup — which check_allowed_domain() then required. In v2 that
// table is covered by the config write policy, which needs can_bootstrap(),
// and anon has no auth.uid(): the pre-signup insert fails with 42501.
//
// It is also no longer needed. check_allowed_domain() bypasses the domain and
// invite checks entirely for the very first account, so the captain signs up
// against an empty allowed_login_domains table. Their domain is registered
// afterwards, from their own authenticated session, as part of org setup.
//
// Gating note: "is setup needed" is NOT "are priority_levels empty". The real
// signal is whether anyone holds the 'admin' tag yet — the same
// is_bootstrapping() predicate the RLS policies in schema-v2/0003_rls.sql use,
// exposed as an RPC because it has to be callable pre-auth.
//
// is_bootstrapping() being true no longer implies "no account exists": the
// captain is created here, and setup only finishes later, on the levels page.
// App.tsx decides between the two on whether a session exists.

export async function isSetupComplete(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_bootstrapping');
  if (error) throw error;
  return data === false;
}

export async function ensureDomainAllowed(email: string) {
  const domain = email.split('@')[1];
  if (!domain) throw new Error('Invalid email address.');
  const { error } = await supabase.rpc('add_allowed_domains', { p_domains: [domain] });
  if (error) throw error;
  return domain;
}

export async function createCaptainAccount(fullName: string, email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
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
  const verify = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code,
  });
  if (verify.error) throw verify.error;
  return verify.data;
}

export async function addAllowedDomains(domains: string[]) {
  if (domains.length === 0) return;
  const { error } = await supabase.rpc('add_allowed_domains', { p_domains: domains });
  if (error) throw error;
}
