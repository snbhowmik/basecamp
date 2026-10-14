<script setup lang="ts">
import { ref, watch } from 'vue';
import TaskRow from './TaskRow.vue';
import type { UserContext } from '../lib/context';
import type { RequestRow } from '../lib/requests';
import { getRequestStageStatus, type StageStatus, type StageStatusTask, type StageParticipant } from '../lib/workflow';

// The current stage's tasks. One row per (task, participant) for
// per_participant scope, one per task otherwise. Answering overwrites; there
// is no per-task audit trail (HANDOFF §7).
const props = defineProps<{ ctx: UserContext; request: RequestRow }>();
const emit = defineEmits<{ saved: [] }>();

const status = ref<StageStatus | null>(null);

const load = () => getRequestStageStatus(props.request.id, props.request.current_stage_id)
  .then((s) => { status.value = s; }).catch(() => { status.value = null; });
watch(() => [props.request.id, props.request.current_stage_id], load, { immediate: true });

const findResult = (taskId: string, participantId: string | null) =>
  status.value?.results.find((r) => r.task_id === taskId && r.participant_id === participantId);

function canAct(task: StageStatusTask, p: StageParticipant | null) {
  const { ctx, request } = props;
  if (ctx.isCaptain) return true;
  if (task.actor === 'stage_role') return request.current_holder === ctx.profile.id;
  if (task.actor === 'requester') return request.requested_by === ctx.profile.id;
  return request.requested_by === ctx.profile.id
    || (p?.member_id === ctx.profile.id && p.acceptance_status === 'accepted');
}

const hintFor = (actor: StageStatusTask['actor']) =>
  actor === 'stage_role' ? 'Filled in by whoever the request is currently with.'
    : actor === 'requester' ? 'Filled in by the person who raised the request.'
      : 'Filled in by the requester or the participant it concerns.';

const saved = () => { load(); emit('saved'); };
</script>

<template>
  <div v-if="status && status.tasks.length" class="space-y-2">
    <div class="text-sm text-ink-gray-5">{{ status.stage_name }} — tasks</div>
    <template v-for="task in status.tasks" :key="task.id">
      <template v-if="task.scope === 'per_participant'">
        <TaskRow v-if="!status.participants.length" :task="task" :participant="null" :editable="false"
                 hint="No participants on this request yet." :request-id="request.id" @saved="saved" />
        <TaskRow v-for="p in status.participants" v-else :key="`${task.id}:${p.id}`" :task="task" :participant="p"
                 :result="findResult(task.id, p.id)" :editable="canAct(task, p)" :hint="hintFor(task.actor)"
                 :request-id="request.id" @saved="saved" />
      </template>
      <TaskRow v-else :task="task" :participant="null" :result="findResult(task.id, null)"
               :editable="canAct(task, null)" :hint="hintFor(task.actor)" :request-id="request.id" @saved="saved" />
    </template>
  </div>
</template>
