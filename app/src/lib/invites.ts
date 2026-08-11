import { supabase } from './supabase';
import type { PendingAssignment, PriorityLevel, Tag, Department, Class } from '../types';

// Catalog reads — used to populate the invite form. RLS: priority_levels/
// tags/departments/classes are all readable by any authenticated user
// (0003_wizard_rls.sql), so these are plain selects, no special handling.

export async function listPriorityLevels(): Promise<PriorityLevel[]> {
  const { data, error } = await supabase.from('priority_levels').select('*').order('rank');
  if (error) throw error;
  return data ?? [];
}

export async function listTags(): Promise<Tag[]> {
  const { data, error } = await supabase.from('tags').select('*').order('label');
  if (error) throw error;
  return data ?? [];
}

export async function listDepartments(): Promise<Department[]> {
  const { data, error } = await supabase.from('departments').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function listClasses(departmentId: string): Promise<Class[]> {
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .eq('department_id', departmentId)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function listMyInvites(): Promise<PendingAssignment[]> {
  const { data, error } = await supabase
    .from('pending_assignments')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export interface CreateInviteInput {
  email: string;
  levelId: string;
  tagCodes: string[];
  departmentId: string | null;
  classId: string | null;
  regNo: string | null;
  year: number | null;
}

export async function createInvite(input: CreateInviteInput) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const { error } = await supabase.from('pending_assignments').insert({
    email: input.email.trim().toLowerCase(),
    level_id: input.levelId,
    tag_codes: input.tagCodes,
    department_id: input.departmentId,
    class_id: input.classId,
    reg_no: input.regNo,
    year: input.year,
    invited_by: user.id,
  });
  // RLS (can_invite()) is the real gate — a rejected insert surfaces here as
  // a generic 42501 from PostgREST; the caller decides how to present it.
  if (error) throw error;
}

export async function revokeInvite(id: string) {
  const { error } = await supabase.from('pending_assignments').delete().eq('id', id);
  if (error) throw error;
}
