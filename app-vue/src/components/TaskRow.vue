<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, FormControl, ErrorMessage, Badge } from 'frappe-ui';
import { recordTaskResult, type StageStatusTask, type TaskResult, type StageParticipant } from '../lib/workflow';
import { uploadAttachment } from '../lib/attachments';
import { errorMessage } from '../lib/requests';

const props = defineProps<{
  task: StageStatusTask;
  participant: StageParticipant | null;
  result?: TaskResult;
  editable: boolean;
  hint: string;
  requestId: string;
}>();
const emit = defineEmits<{ saved: [] }>();

const value = ref(props.result ? String((props.result.answer as string | number | undefined) ?? '') : '');
const busy = ref(false);
const error = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

const label = computed(() => props.participant ? `${props.task.label} — ${props.participant.snapshot_name}` : props.task.label);
const fileName = computed(() => (props.result?.answer as { file_name?: string } | null)?.file_name);
const selectOptions = computed(() => {
  switch (props.task.answer_type) {
    case 'yes_no': return [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }];
    case 'acknowledge': return [{ label: 'Acknowledge', value: 'acknowledged' }];
    case 'choice': return (props.task.options ?? []).map((o) => ({ label: o, value: o }));
    default: return null;
  }
});
const inputType = computed(() => props.task.answer_type === 'number' ? 'number' : props.task.answer_type === 'date' ? 'date' : 'text');

async function save(answer: unknown) {
  busy.value = true; error.value = '';
  try {
    await recordTaskResult(props.requestId, props.task.id, answer, props.participant?.id ?? null);
    emit('saved');
  } catch (e) { error.value = errorMessage(e, 'Could not save this answer.'); }
  finally { busy.value = false; }
}
const submit = () => value.value !== '' && save(props.task.answer_type === 'number' ? Number(value.value) : value.value);

async function pickFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  busy.value = true; error.value = '';
  try {
    const attachmentId = await uploadAttachment(props.requestId, file);
    await recordTaskResult(props.requestId, props.task.id, { attachment_id: attachmentId, file_name: file.name }, props.participant?.id ?? null);
    emit('saved');
  } catch (err) { error.value = errorMessage(err, 'Could not save that file.'); }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="rounded-6 border p-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="space-y-1">
        <div class="text-base-medium">{{ label }}<span v-if="task.is_required" class="text-ink-red-7"> *</span></div>
        <template v-if="task.answer_type === 'file'">
          <Badge v-if="result" theme="green" :label="`Uploaded: ${fileName ?? 'file'}`" />
          <div v-else class="text-p-sm text-ink-gray-5">{{ hint }}</div>
        </template>
        <Badge v-else-if="result" :theme="result.result === 'failed' ? 'red' : 'green'" :label="result.result === 'failed' ? 'Recorded — did not clear' : 'Recorded'" />
      </div>

      <template v-if="editable">
        <div v-if="task.answer_type === 'file'">
          <input ref="fileInput" type="file" class="hidden" @change="pickFile" />
          <Button size="sm" :loading="busy" @click="fileInput?.click()">{{ result ? 'Replace file' : 'Attach file' }}</Button>
        </div>
        <div v-else class="flex items-center gap-2">
          <FormControl v-if="selectOptions" v-model="value" type="select" :options="selectOptions" class="w-40" />
          <FormControl v-else v-model="value" :type="inputType" class="w-48" />
          <Button size="sm" :loading="busy" :disabled="value === ''" @click="submit">{{ result ? 'Update' : 'Save' }}</Button>
        </div>
      </template>
      <span v-else-if="task.answer_type !== 'file'" class="text-p-sm text-ink-gray-5">
        {{ result ? String((result.answer as string | number | undefined) ?? '') : hint }}
      </span>
    </div>
    <ErrorMessage class="mt-2" :message="error" />
  </div>
</template>
