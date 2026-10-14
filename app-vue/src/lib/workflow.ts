import { supabase } from './supabase';

// Stage status and task results — subset of app/src/lib/workflow.ts (the
// editor-side saves stay in React until the Workflow page is ported).
export type AnswerType =
  | 'yes_no' | 'choice' | 'text' | 'number' | 'date' | 'file' | 'acknowledge';
export type TaskActor = 'stage_role' | 'requester' | 'any_participant';
export type TaskScope = 'request' | 'per_participant';
export type StageKind = 'approval' | 'post_approval';

export interface StageStatusTask {
  id: string;
  label: string;
  answer_type: AnswerType;
  options: string[] | null;
  passing_answers: string[] | null;
  actor: TaskActor;
  scope: TaskScope;
  is_required: boolean;
}

export interface TaskResult {
  task_id: string;
  participant_id: string | null;
  result: 'passed' | 'failed' | 'na';
  answer: unknown;
  note: string | null;
}

export interface StageParticipant {
  id: string;
  snapshot_name: string;
  snapshot_reg_no: string;
  member_id: string;
  acceptance_status: 'pending' | 'accepted' | 'declined';
}

export interface StageStatus {
  stage_id: string;
  stage_name: string;
  stage_kind: StageKind;
  tasks: StageStatusTask[];
  results: TaskResult[];
  participants: StageParticipant[];
}

export async function getRequestStageStatus(
  requestId: string,
  currentStageId: string | null,
): Promise<StageStatus | null> {
  if (!currentStageId) return null;

  const [stageRes, tasksRes, resultsRes, participantsRes] = await Promise.all([
    supabase.from('category_stages').select('id, name, stage_kind').eq('id', currentStageId).maybeSingle(),
    supabase
      .from('stage_tasks')
      .select('id, label, answer_type, options, passing_answers, actor, scope, is_required, sort_order')
      .eq('stage_id', currentStageId)
      .order('sort_order'),
    supabase
      .from('request_check_results')
      .select('task_id, participant_id, result, answer, note')
      .eq('request_id', requestId)
      .not('task_id', 'is', null),
    supabase
      .from('request_participants')
      .select('id, snapshot_name, snapshot_reg_no, member_id, acceptance_status')
      .eq('request_id', requestId),
  ]);
  if (stageRes.error) throw stageRes.error;
  if (!stageRes.data) return null;
  if (tasksRes.error) throw tasksRes.error;
  if (resultsRes.error) throw resultsRes.error;
  if (participantsRes.error) throw participantsRes.error;

  return {
    stage_id: stageRes.data.id,
    stage_name: stageRes.data.name,
    stage_kind: stageRes.data.stage_kind,
    tasks: tasksRes.data ?? [],
    results: (resultsRes.data ?? []) as TaskResult[],
    participants: (participantsRes.data ?? []) as StageParticipant[],
  };
}

export async function getOutstandingTaskCount(requestId: string): Promise<number> {
  const { data, error } = await supabase.rpc('stage_tasks_outstanding', { p_request_id: requestId });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

export async function recordTaskResult(
  requestId: string,
  taskId: string,
  answer: unknown,
  participantId: string | null,
  note?: string | null,
) {
  const { error } = await supabase.rpc('record_task_result', {
    p_request_id: requestId,
    p_task_id: taskId,
    p_answer: answer,
    p_participant_id: participantId,
    p_note: note ?? null,
    p_acted_as: null,
  });
  if (error) throw error;
}

// ── Editor side (captain's workflow editor) — copied from app/src/lib/workflow.ts ──
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

// ------------------------------------------------------------------
