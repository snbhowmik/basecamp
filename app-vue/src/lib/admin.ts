import { supabase } from './supabase';

// Destructive admin actions.
//
// The TOTP prompt is not decoration and not a client-side check. Re-running the
// MFA challenge mints a new access token whose `amr` claim carries a fresh
// totp timestamp, and admin_delete() reads that claim server-side via
// recently_verified_totp(). Skipping the dialog does not skip the control:
// the delete is refused by the database.
//
// Deletion is also unavailable through PostgREST directly — the config tables
// carry insert and update policies only — so admin_delete() is the single way
// through, and it refuses while anything still references the row.

export async function reverifyTotp(code: string): Promise<void> {
  const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
  if (listErr) throw listErr;

  const factor = (factors.totp ?? []).find((f) => f.status === 'verified');
  if (!factor) throw new Error('No verified authenticator is enrolled on this account.');

  const challenge = await supabase.auth.mfa.challenge({ factorId: factor.id });
  if (challenge.error) throw challenge.error;

  const verify = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.data.id,
    code,
  });
  if (verify.error) throw verify.error;
}

export type DeletableTable =
  | 'priority_levels' | 'org_units' | 'batches' | 'sections' | 'tags'
  | 'request_types' | 'request_categories' | 'field_definitions'
  | 'category_first_hop_options' | 'level_checks' | 'role_assignments'
  | 'pending_assignments' | 'allowed_login_domains';

export async function adminDelete(table: DeletableTable, id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete', { p_table: table, p_id: id });
  if (error) throw error;
}
