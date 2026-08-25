import { supabase } from './supabase';

// Stages and tasks — schema-v2/0026–0029. Everything here goes through an
// RPC: the frontend never writes these tables directly, and each save sends
// its whole changed set in one call rather than one call per row. That is the
// captain's rule about save/cancel, and the reason he gave for it was fewer
// concurrent connections — a Save button that then fires twelve rpc() calls
// in a loop would have the button and none of the benefit.

export type AnswerType =
  | 'yes_no' | 'choice' | 'text' | 'number' | 'date' | 'file' | 'acknowledge';
export type TaskActor = 'stage_role' | 'requester' | 'any_participant';
export type TaskScope = 'request' | 'per_participant';
export type StageKind = 'approval' | 'post_approval';

export interface StageTask {
  id: string | null;
  label: string;
  answer_type: AnswerType;
  options: string[] | null;
  passing_answers: string[] | null;
  actor: TaskActor;
  scope: TaskScope;
  is_required: boolean;
  sort_order: number;
}

export interface Stage {
  id: string | null;
  stage_no: number;
  name: string;
  level_id: string;
  level_name?: string;
  is_optional: boolean;
  stage_kind: StageKind;
  tasks: StageTask[];
}

export interface CategoryInitiator {
  tag_id: string;
  code: string;
  label: string;
}

export interface CategoryWorkflow {
  category_id: string;
  initiators: CategoryInitiator[];
  stages: Stage[];
}

// One read for the whole editor, nested, rather than one per stage.
export async function getCategoryWorkflow(categoryId: string): Promise<CategoryWorkflow> {
  const { data, error } = await supabase.rpc('category_workflow', { p_category_id: categoryId });
  if (error) throw error;
  return data as CategoryWorkflow;
}

// Whole-set save. Stages not in the payload are removed server-side — which
// is refused if answers have been recorded against them on a live request.
export async function saveCategoryStages(categoryId: string, stages: Stage[]) {
  const { error } = await supabase.rpc('save_category_stages', {
    p_category_id: categoryId,
    p_stages: stages.map((s) => ({
      id: s.id,
      stage_no: s.stage_no,
      name: s.name,
      level_id: s.level_id,
      is_optional: s.is_optional,
      stage_kind: s.stage_kind,
    })),
  });
  if (error) throw error;
}

export async function saveStageTasks(stageId: string, tasks: StageTask[]) {
  const { error } = await supabase.rpc('save_stage_tasks', {
    p_stage_id: stageId,
    p_tasks: tasks.map((t) => ({
      id: t.id,
      label: t.label,
      answer_type: t.answer_type,
      options: t.options,
      passing_answers: t.passing_answers,
      actor: t.actor,
      scope: t.scope,
      is_required: t.is_required,
      sort_order: t.sort_order,
    })),
  });
  if (error) throw error;
}

// An empty list means the category is open to everyone, which is also what a
// category with no rows already meant.
export async function saveCategoryInitiators(categoryId: string, tagIds: string[]) {
  const { error } = await supabase.rpc('save_category_initiators', {
    p_category_id: categoryId,
    p_tag_ids: tagIds,
  });
  if (error) throw error;
}
