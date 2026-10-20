<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Dialog, FormControl, Button, ErrorMessage, Checkbox } from 'frappe-ui';
import {
  getCategoryWorkflow, saveCategoryStages, saveStageTasks, saveCategoryInitiators,
  type Stage, type StageTask, type CategoryWorkflow, type AnswerType, type TaskActor, type TaskScope, type StageKind,
} from '../lib/workflow';
import type { PriorityLevel, RequestCategory, Tag } from '../lib/types';
import { errorMessage } from '../lib/requests';

// The captain writes the workflow here: who may file a category, and the
// stages a request walks with the tasks filled in at each. Nothing is saved as
// it is typed — the draft lives here until Save, which sends whole sets (0027).
const props = defineProps<{ category: RequestCategory; levels: PriorityLevel[]; tags: Tag[] }>();
const open = defineModel<boolean>('open', { required: true });

const ANSWER_TYPES = [
  { value: 'yes_no', label: 'Yes / No' }, { value: 'choice', label: 'One of a list' }, { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' }, { value: 'date', label: 'Date' }, { value: 'file', label: 'File upload' },
  { value: 'acknowledge', label: 'Acknowledge' },
];
const ACTORS = [
  { value: 'stage_role', label: 'Whoever it is with' }, { value: 'requester', label: 'The requester' }, { value: 'any_participant', label: 'Anyone on it' },
];
const KINDS = [{ value: 'approval', label: 'Part of the approval' }, { value: 'post_approval', label: 'Follow-up after approval' }];

const list = (v: string[] | null) => (v ?? []).join(', ');
const parseList = (s: string) => { const p = s.split(',').map((x) => x.trim()).filter(Boolean); return p.length ? p : null; };
const renumberTasks = (ts: StageTask[]) => ts.map((t, n) => ({ ...t, sort_order: n }));
const renumber = (ss: Stage[]) => ss.map((s, n) => ({ ...s, stage_no: n + 1 }));
const emptyTask = (sortOrder: number): StageTask => ({
  id: null, label: '', answer_type: 'yes_no', options: null, passing_answers: null,
  actor: 'stage_role', scope: 'request', is_required: true, sort_order: sortOrder,
});
const clone = (ss: Stage[]) => ss.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }));

const loaded = ref<CategoryWorkflow | null>(null);
const stages = ref<Stage[]>([]);
const initiators = ref<string[]>([]);
const error = ref('');
const busy = ref(false);

function adopt(w: CategoryWorkflow) {
  loaded.value = w; stages.value = clone(w.stages); initiators.value = w.initiators.map((i) => i.tag_id);
}
watch(() => props.category.id, (id) => {
  loaded.value = null; error.value = '';
  getCategoryWorkflow(id).then(adopt).catch((e) => { error.value = errorMessage(e, 'Could not load this category’s workflow.'); });
}, { immediate: true });

const dirty = computed(() => {
  if (!loaded.value) return false;
  const strip = (ss: Stage[]) => ss.map((s) => ({ id: s.id, stage_no: s.stage_no, name: s.name, level_id: s.level_id, is_optional: s.is_optional, stage_kind: s.stage_kind, tasks: s.tasks }));
  return JSON.stringify(strip(stages.value)) !== JSON.stringify(strip(loaded.value.stages))
    || JSON.stringify([...initiators.value].sort()) !== JSON.stringify(loaded.value.initiators.map((i) => i.tag_id).sort());
});

function patchStage(i: number, patch: Partial<Stage>) {
  const s = stages.value[i];
  const next = { ...s, ...patch };
  // A follow-up stage sits on nobody's desk, so "whoever it is with" has no answer there. Move those
  // tasks over as the kind flips, rather than letting the save fail on 0029's guard.
  if (next.stage_kind === 'post_approval' && s.stage_kind !== 'post_approval') {
    next.tasks = next.tasks.map((t) => (t.actor === 'stage_role' ? { ...t, actor: 'requester' as TaskActor } : t));
  }
  stages.value = stages.value.map((x, n) => (n === i ? next : x));
}
function patchTask(si: number, ti: number, patch: Partial<StageTask>) {
  stages.value = stages.value.map((s, n) => (n === si ? { ...s, tasks: s.tasks.map((t, m) => (m === ti ? { ...t, ...patch } : t)) } : s));
}
const addStage = () => { stages.value = renumber([...stages.value, { id: null, stage_no: stages.value.length + 1, name: '', level_id: props.levels[0]?.id ?? '', is_optional: false, stage_kind: 'approval', tasks: [] }]); };
function move(i: number, by: number) {
  const next = [...stages.value]; const j = i + by;
  if (j < 0 || j >= next.length) return;
  [next[i], next[j]] = [next[j], next[i]];
  stages.value = renumber(next);
}
const removeStage = (i: number) => { stages.value = renumber(stages.value.filter((_, n) => n !== i)); };
const toggleInitiator = (id: string, on: boolean) => { initiators.value = on ? [...initiators.value, id] : initiators.value.filter((x) => x !== id); };

async function save() {
  busy.value = true; error.value = '';
  try {
    await saveCategoryInitiators(props.category.id, initiators.value);
    await saveCategoryStages(props.category.id, stages.value);
    // Stages just created have no id until the call above lands, so ids come back from one re-read.
    const fresh = await getCategoryWorkflow(props.category.id);
    const before = new Map(loaded.value?.stages.map((s) => [s.id, s.tasks]) ?? []);
    for (const draft of stages.value) {
      const saved = fresh.stages.find((s) => s.stage_no === draft.stage_no);
      if (!saved?.id) continue;
      const unchanged = draft.id && JSON.stringify(before.get(draft.id) ?? []) === JSON.stringify(draft.tasks);
      if (unchanged) continue;
      await saveStageTasks(saved.id, draft.tasks);
    }
    adopt(await getCategoryWorkflow(props.category.id));
  } catch (e) { error.value = errorMessage(e, 'Could not save this workflow.'); }
  finally { busy.value = false; }
}

function cancel() { if (loaded.value) { adopt(loaded.value); error.value = ''; } }

const levelOptions = computed(() => props.levels.map((l) => ({ label: l.name, value: l.id })));
const actorOptions = (s: Stage) => ACTORS.filter((a) => !(s.stage_kind === 'post_approval' && a.value === 'stage_role'));
const fileTags = computed(() => props.tags.filter((t) => !t.code.startsWith('org:')));
</script>

<template>
  <Dialog v-model:open="open" :title="`Workflow — ${category.name}`" size="5xl" :actions="[]">
    <div class="space-y-6">
      <ErrorMessage :message="error" />
      <p v-if="!loaded && !error" class="text-p-sm text-ink-gray-5">Loading…</p>

      <template v-if="loaded">
        <section class="space-y-2">
          <h3 class="text-lg-semibold">Who can file this</h3>
          <p class="text-p-sm text-ink-gray-5">Tick the roles allowed to raise this kind of request. Tick nothing and it stays open to everyone, which is what it is today.</p>
          <div class="flex flex-wrap gap-x-5 gap-y-2">
            <Checkbox v-for="t in fileTags" :key="t.id" :label="t.label" :model-value="initiators.includes(t.id)" @update:model-value="toggleInitiator(t.id, !!$event)" />
          </div>
        </section>

        <section class="space-y-3">
          <h3 class="text-lg-semibold">Stages and their tasks</h3>
          <p class="text-p-sm text-ink-gray-5">A request walks these in order, and each one is checked by the role you pick. A stage is done when its tasks are filled in. A follow-up stage is not part of the approval — it opens once the request is approved, for the certificate or the photos after the event.</p>
          <p v-if="!stages.length" class="text-p-sm text-ink-gray-5">No stages — requests in this category go wherever the first-hop picker sends them.</p>

          <div v-for="(s, si) in stages" :key="s.id ?? `new-${si}`" class="space-y-3 rounded-6 border p-4">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormControl :model-value="s.name" :label="`Stage ${s.stage_no}`" placeholder="HOD approval" @update:model-value="patchStage(si, { name: String($event ?? '') })" />
              <FormControl :model-value="s.level_id" type="select" label="Checked by" :options="levelOptions" @update:model-value="patchStage(si, { level_id: String($event) })" />
              <FormControl :model-value="s.stage_kind" type="select" label="Kind" :options="KINDS" @update:model-value="patchStage(si, { stage_kind: $event as StageKind })" />
            </div>

            <div v-for="(t, ti) in s.tasks" :key="t.id ?? `t-${ti}`" class="space-y-2 rounded-4 bg-surface-gray-1 p-3">
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                <FormControl :model-value="t.label" label="Task" placeholder="Parent permission taken" @update:model-value="patchTask(si, ti, { label: String($event ?? '') })" />
                <FormControl :model-value="t.answer_type" type="select" label="Answer" :options="ANSWER_TYPES" @update:model-value="patchTask(si, ti, { answer_type: $event as AnswerType })" />
                <FormControl :model-value="t.actor" type="select" label="Filled in by" :options="actorOptions(s)" @update:model-value="patchTask(si, ti, { actor: $event as TaskActor })" />
              </div>
              <div v-if="t.answer_type === 'choice' || t.answer_type === 'yes_no'" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormControl v-if="t.answer_type === 'choice'" :model-value="list(t.options)" placeholder="Options, comma separated" @update:model-value="patchTask(si, ti, { options: parseList(String($event ?? '')) })" />
                <FormControl :model-value="list(t.passing_answers)" placeholder="Answers that clear it (blank: any)" @update:model-value="patchTask(si, ti, { passing_answers: parseList(String($event ?? '')) })" />
              </div>
              <div class="flex items-center gap-5">
                <Checkbox label="Per person" :model-value="t.scope === 'per_participant'" @update:model-value="patchTask(si, ti, { scope: (!!$event ? 'per_participant' : 'request') as TaskScope })" />
                <Checkbox label="Required" :model-value="t.is_required" @update:model-value="patchTask(si, ti, { is_required: !!$event })" />
                <Button variant="ghost" class="ml-auto" aria-label="Remove task" @click="patchStage(si, { tasks: renumberTasks(s.tasks.filter((_, m) => m !== ti)) })"><span class="lucide-trash-2 size-4" aria-hidden="true" /></Button>
              </div>
            </div>

            <div class="flex items-center gap-1">
              <Button size="sm" @click="patchStage(si, { tasks: renumberTasks([...s.tasks, emptyTask(s.tasks.length)]) })">Add task</Button>
              <Button variant="ghost" aria-label="Move up" @click="move(si, -1)"><span class="lucide-arrow-up size-4" aria-hidden="true" /></Button>
              <Button variant="ghost" aria-label="Move down" @click="move(si, 1)"><span class="lucide-arrow-down size-4" aria-hidden="true" /></Button>
              <Button variant="ghost" class="ml-auto" aria-label="Remove stage" @click="removeStage(si)"><span class="lucide-trash-2 size-4" aria-hidden="true" /></Button>
            </div>
          </div>

          <Button size="sm" :disabled="!levels.length" @click="addStage">Add stage</Button>
        </section>
      </template>

      <div class="flex items-center justify-end gap-3 border-t pt-4">
        <span class="mr-auto text-p-sm text-ink-gray-5">{{ dirty ? 'Unsaved changes.' : 'Everything here is saved.' }}</span>
        <Button :disabled="busy" @click="dirty ? cancel() : (open = false)">{{ dirty ? 'Cancel changes' : 'Done' }}</Button>
        <Button variant="solid" :loading="busy" :disabled="!dirty" @click="save">Save</Button>
      </div>
    </div>
  </Dialog>
</template>
