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
