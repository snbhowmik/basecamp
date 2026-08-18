import { supabase } from './supabase';
import type { PriorityLevel } from '../types';

// Priority levels are the authority ladder. They are created once, from the
// dashboard, by the captain — not seeded, and not part of the signup wizard.
//
// The captain is NOT a level. They are identified by the 'admin' tag and sit
// above the ladder entirely, because has_tag('admin') is load-bearing across
// every policy in 0003_rls.sql. They are additionally given the top level so
// that rank-based logic (my_best_rank, can_invite) has something to compare
// against, but their authority does not come from it.
//
// Levels are append-only. Rank 1 is the highest authority; the lowest is
// flagged is_base, which is what self-registration and is_lowest_level()
// resolve through — not max(rank), which breaks the moment a level is added
// below the base one (SECURITY.md R-27).

export interface DraftLevel {
  name: string;
  // Optional on purpose: the captain names the whole ladder up front without
  // being forced to invent a tag for each rung. Filled in later from the same
  // page.
  tagCode: string;
  tagLabel: string;
}

export async function listLevels(): Promise<PriorityLevel[]> {
  const { data, error } = await supabase.from('priority_levels').select('*').order('rank');
  if (error) throw error;
  return data ?? [];
}

// First run. One RPC, one transaction: the whole ladder, the captain's own
// role assignment, and the admin tag that closes the bootstrap window. Doing
// this as a sequence of client writes risked failing part-way and leaving the
// captain without the authority to finish what they started.
export async function completeLevelSetup(drafts: DraftLevel[]): Promise<void> {
  const payload = drafts.map((d) => ({
    name: d.name.trim(),
    tag_code: d.tagCode.trim().toLowerCase(),
    tag_label: d.tagLabel.trim(),
  }));
  const { error } = await supabase.rpc('setup_levels', { p_levels: payload });
  if (error) throw error;
}

// Append-only addition after setup. The new level lands at the bottom and
// takes is_base with it, atomically — see append_level() for why that has to
// happen in the same transaction.
export async function appendLevel(draft: DraftLevel): Promise<string> {
  const { data, error } = await supabase.rpc('append_level', {
    p_name: draft.name.trim(),
    p_tag_code: draft.tagCode.trim().toLowerCase() || null,
    p_tag_label: draft.tagLabel.trim() || null,
  });
  if (error) throw error;
  return data as string;
}

export async function renameLevel(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('priority_levels').update({ name: name.trim() }).eq('id', id);
  if (error) throw error;
}
