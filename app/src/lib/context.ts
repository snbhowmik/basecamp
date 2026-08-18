import { supabase } from './supabase';
import type { Profile } from '../types';

// Who is signed in, and what are they allowed to see? Nav and page gating
// read from this. It is UX only — every actual permission is enforced by
// RLS in the database (SECURITY.md R-07). Hiding a tab is not a control.
//
// v2 note: a user can hold several role_assignments at once, so `rank` is
// my_best_rank() — the strongest level they hold anywhere. Anything that
// depends on authority *within* one org unit must call my_rank_in() instead;
// this context cannot answer that and must not be used to.
export interface UserContext {
  profile: Profile;
  tagCodes: string[];
  rank: number | null;
  isCaptain: boolean;
  isStaff: boolean;
}

export async function loadUserContext(): Promise<UserContext | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileRes, tagsRes, rankRes, baseRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('user_tags').select('tags(code)').eq('user_id', user.id),
    supabase.rpc('my_best_rank'),
    supabase.rpc('is_lowest_level'),
  ]);

  if (profileRes.error) throw profileRes.error;

  const tagCodes = (tagsRes.data ?? [])
    .flatMap((row: { tags: { code: string } | { code: string }[] | null }) =>
      row.tags ? (Array.isArray(row.tags) ? row.tags.map((t) => t.code) : [row.tags.code]) : [],
    );

  return {
    profile: profileRes.data,
    tagCodes,
    rank: typeof rankRes.data === 'number' ? rankRes.data : null,
    isCaptain: tagCodes.includes('admin'),
    // is_lowest_level() returns null when the user holds no level at all —
    // treat "unknown" as not-staff rather than assuming elevated access.
    isStaff: baseRes.data === false,
  };
}
