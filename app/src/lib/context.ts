import { supabase } from './supabase';
import type { Profile } from '../types';

// Who is signed in, and what are they allowed to see? Nav and page gating
// read from this. It is UX only — every actual permission is enforced by
// RLS in the database (SECURITY.md R-07). Hiding a tab is not a control.
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
    supabase.rpc('my_rank'),
    supabase.rpc('is_base_level'),
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
    // is_base_level() returns null when the user holds no level at all —
    // treat "unknown" as not-staff rather than assuming elevated access.
    isStaff: baseRes.data === false,
  };
}
