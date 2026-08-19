import { supabase } from './supabase';
import type { PriorityLevel } from '../types';

// Priority levels are the authority ladder. They are created once, from the
// dashboard, by the captain — not seeded, and not part of the signup wizard.
//
// The captain gets their own reserved rung at the top, created automatically
// by setup_levels() — the captain never types it. Their authority still comes
// from the 'admin' tag (has_tag('admin') is load-bearing across 0003_rls.sql);
// the rung exists so rank comparisons place them above the highest named
// level. Sharing a rank with Dean meant can_invite's `rank > mine` test
// excluded Dean, so the captain could not invite one.
//
// Ranks are sparse (10, 20, 30 ...). The lowest level is flagged is_base,
// which is what self-registration and is_lowest_level() resolve through — not
// max(rank), which breaks the moment a level is added below the base one
// (SECURITY.md R-27).

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

// Append at the bottom of the ladder. The new level takes is_base with it,
// atomically — see append_level() for why that has to happen in the same
// transaction. To add a level in the middle, use insertLevelAfter().
export async function appendLevel(draft: DraftLevel): Promise<string> {
  const { data, error } = await supabase.rpc('append_level', {
    p_name: draft.name.trim(),
    p_tag_code: draft.tagCode.trim().toLowerCase() || null,
    p_tag_label: draft.tagLabel.trim() || null,
  });
  if (error) throw error;
  return data as string;
}

// Insert between two existing levels. Ranks are allocated sparsely (10, 20,
// 30 ...) precisely so this can take the midpoint of a gap without moving any
// existing level — in-flight tickets resolve authority through a level's rank,
// so renumbering would change what they mean.
export async function insertLevelAfter(afterLevelId: string, draft: DraftLevel): Promise<string> {
  const { data, error } = await supabase.rpc('insert_level_after', {
    p_after_level_id: afterLevelId,
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

// Attach or replace the role tag on an existing level — the "or after" half of
// how tagging was described. Reuses a tag with the same code rather than
// failing, so retagging two levels through the same code is not an error the
// captain has to understand.
export async function setLevelTag(levelId: string, code: string, label: string): Promise<void> {
  const trimmed = code.trim().toLowerCase();
  if (!trimmed) {
    const { error } = await supabase.from('priority_levels').update({ tag_id: null }).eq('id', levelId);
    if (error) throw error;
    return;
  }
  if (trimmed === 'admin') throw new Error('The tag "admin" is reserved for the captain.');

  let tagId: string;
  const { data, error } = await supabase
    .from('tags').insert({ code: trimmed, label: label.trim() || trimmed, tag_type: 'role' })
    .select('id').single();
  if (!error) {
    tagId = data.id;
  } else if (error.code === '23505') {
    const { data: existing, error: selErr } = await supabase
      .from('tags').select('id').eq('code', trimmed).single();
    if (selErr) throw selErr;
    tagId = existing.id;
  } else {
    throw error;
  }

  const { error: updErr } = await supabase
    .from('priority_levels').update({ tag_id: tagId }).eq('id', levelId);
  if (updErr) throw updErr;
}
