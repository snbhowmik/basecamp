import { supabase } from './supabase';

// UX only — every real permission is enforced by RLS (SECURITY.md R-07).
// Hiding a nav item is not a control. Ported from app/src/lib/context.ts.
export interface Profile { id: string; full_name: string; email: string }

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

  const tagCodes = (tagsRes.data ?? []).flatMap(
    (row: { tags: { code: string } | { code: string }[] | null }) =>
      row.tags ? (Array.isArray(row.tags) ? row.tags.map((t) => t.code) : [row.tags.code]) : [],
  );

  return {
    profile: profileRes.data,
    tagCodes,
    rank: typeof rankRes.data === 'number' ? rankRes.data : null,
    isCaptain: tagCodes.includes('admin'),
    isStaff: baseRes.data === false,
  };
}
