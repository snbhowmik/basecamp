import { supabase } from './supabase';

// First-boot setup wizard, per PRD.md §5.
//
// The wizard creates exactly one account: the captain — the only account
// created outside the normal in-app flow. Every other account (Dean, HOD,
// Mentor, Student, Student Outreach Faculty, ...) is created by hand
// afterward, inside the app, by someone who already holds the right level.
// No fixture data — see README.md "No Fixture Data — the Captain Builds
// the Org By Hand". The captain is identified by the `admin` tag *code*
// (kept as-is, not renamed to 'captain', because has_tag('admin') is
// load-bearing throughout 0002_functions_and_rls.sql) with the label
// "Captain" shown in the UI.
//
// Bootstrap ordering note: `allowed_login_domains` has no admin-only RLS (it's
// a config table, see 0002_functions_and_rls.sql), but auth.users itself has
// a trigger (`check_allowed_domain`) that rejects signup unless the email's
// domain is already present in that table. So the captain's own domain has
// to be inserted *before* the captain account is created — even though the
// PRD lists "create admin" as step 1 and "configure domains" as step 3. We
// do that domain insert transparently as part of step 1 here; step 3 in the
// UI is for adding any *additional* domains beyond the captain's own.
//
// Gating note: "is setup needed" is NOT "are priority_levels empty" — Basecamp
// ships an optional supabase/seed.sql with example catalog data (priority
// levels, tags, category tree) for demo/reference instances only, never for
// a real deployment. If we gated on catalog rows existing, loading that seed
// would make the wizard never trigger and permanently lock the instance out
// (no captain account, no one holding the 'admin' tag, and every
// non-bootstrap write requires it). The real signal is whether anyone holds
// the 'admin' tag yet — same is_bootstrapping() predicate the RLS policies
// in 0003_wizard_rls.sql use, exposed here as an RPC since it has to be
// callable pre-auth.

export async function isSetupComplete(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_bootstrapping');
  if (error) throw error;
  return data === false;
}

export async function ensureDomainAllowed(email: string) {
  const domain = email.split('@')[1];
  if (!domain) throw new Error('Invalid email address.');
  const { error } = await supabase
    .from('allowed_login_domains')
    .upsert({ domain, is_active: true }, { onConflict: 'domain', ignoreDuplicates: true });
  if (error) throw error;
  return domain;
}

export async function createCaptainAccount(fullName: string, email: string, password: string) {
  await ensureDomainAllowed(email);
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
  const rows = domains.map((domain) => ({ domain, is_active: true }));
  const { error } = await supabase
    .from('allowed_login_domains')
    .upsert(rows, { onConflict: 'domain', ignoreDuplicates: true });
  if (error) throw error;
}

export interface DraftPriorityLevel {
  name: string;
}

export interface DraftDepartment {
  name: string;
  code: string;
}

export interface DraftTag {
  code: string;
  label: string;
}

export interface OrgSetupInput {
  captainUserId: string;
  levels: DraftPriorityLevel[];
  departments: DraftDepartment[];
  extraTags: DraftTag[];
  firstCategoryName: string;
}

// Insert one row; if it collides with an existing row on `conflictColumn`
// (e.g. because supabase/seed.sql pre-loaded example catalog data on a demo
// instance), fetch and return the existing row instead of failing the whole
// wizard run.
async function insertOrGet<T extends Record<string, unknown>>(
  table: string,
  row: Record<string, unknown>,
  conflictColumn: string,
): Promise<T> {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (!error) return data as T;
  if (error.code !== '23505') throw error;

  const { data: existing, error: selErr } = await supabase
    .from(table)
    .select()
    .eq(conflictColumn, row[conflictColumn])
    .single();
  if (selErr) throw selErr;
  return existing as T;
}

export async function completeOrgSetup(input: OrgSetupInput) {
  const { captainUserId, levels, departments, extraTags, firstCategoryName } = input;

  // 1. Priority levels — rank follows list order, rank 1 = top authority.
  // Inserted one at a time (rather than a bulk insert) so a rank collision
  // with pre-existing seed data falls back to reusing that row instead of
  // aborting the whole batch.
  let topLevel: { id: string; rank: number } | null = null;
  for (let i = 0; i < levels.length; i++) {
    const row = await insertOrGet<{ id: string; rank: number }>(
      'priority_levels',
      { rank: i + 1, name: levels[i].name },
      'rank',
    );
    if (row.rank === 1) topLevel = row;
  }
  if (!topLevel) throw new Error('Failed to create priority levels.');

  // 2. Tags — always ensure the 'admin' tag (labeled "Captain"), plus one
  // dept:<code> tag per department, plus any freeform tags the captain
  // defined.
  const tagInputs: DraftTag[] = [
    { code: 'admin', label: 'Captain' },
    ...departments.map((d) => ({ code: `dept:${d.code}`, label: `Department: ${d.name}` })),
    ...extraTags,
  ];
  const tagsByCode = new Map<string, { id: string; code: string }>();
  for (const t of tagInputs) {
    const row = await insertOrGet<{ id: string; code: string }>('tags', { ...t }, 'code');
    tagsByCode.set(t.code, row);
  }

  const captainTag = tagsByCode.get('admin');
  if (!captainTag) throw new Error('Failed to create captain tag.');

  // 3. Departments, linked to their dept:<code> tag.
  for (const d of departments) {
    const tag = tagsByCode.get(`dept:${d.code}`);
    await insertOrGet(
      'departments',
      { name: d.name, code: d.code, tag_id: tag?.id ?? null },
      'code',
    );
  }

  // 4. First request type + category (OD, approval mode).
  const reqType = await insertOrGet<{ id: string; code: string }>(
    'request_types',
    { code: 'od', name: 'On-Duty' },
    'code',
  );

  const { error: catErr } = await supabase.from('request_categories').insert({
    request_type_id: reqType.id,
    code: 'general',
    name: firstCategoryName,
    decision_mode: 'approval',
  });
  if (catErr && catErr.code !== '23505') throw catErr;

  // 5. Grant the captain their tag + top priority level. These are the
  // writes that flip is_bootstrapping() to false — must succeed, no
  // insertOrGet fallback: if they already exist, something upstream is wrong.
  const { error: userTagErr } = await supabase
    .from('user_tags')
    .insert({ user_id: captainUserId, tag_id: captainTag.id });
  if (userTagErr) throw userTagErr;

  const { error: userLevelErr } = await supabase
    .from('user_levels')
    .insert({ user_id: captainUserId, level_id: topLevel.id });
  if (userLevelErr) throw userLevelErr;
}
