<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Dialog, FormControl, Button, ErrorMessage, Badge, Checkbox } from 'frappe-ui';
import ConfirmDestructive from './ConfirmDestructive.vue';
import { createFieldDefinition, updateFieldDefinition } from '../lib/org';
import { listFieldDefinitions, type FieldDefinition, errorMessage } from '../lib/requests';
import { adminDelete } from '../lib/admin';
import type { RequestCategory } from '../lib/types';

// The form a category asks the requester. Fields are per category, so "external"
// and "internal" events can ask for different things. Two keys are special to the
// dashboard: `event_start` and `event_end` (dates) drive "events going on".
const props = defineProps<{ category: RequestCategory }>();
const open = defineModel<boolean>('open', { required: true });

const fields = ref<FieldDefinition[]>([]);
const error = ref('');
const busy = ref(false);
const label = ref('');
const type = ref<'text' | 'textarea' | 'number' | 'date' | 'select'>('text');
const options = ref('');
const required = ref(false);
const editing = ref<string | null>(null);
const editLabel = ref('');
const editRequired = ref(false);
const pending = ref<FieldDefinition | null>(null);
const showDelete = ref(false);

const reload = () => listFieldDefinitions(props.category.id).then((f) => { fields.value = f; }).catch((e) => { error.value = errorMessage(e, 'Could not load fields.'); });
watch(() => props.category.id, reload, { immediate: true });

const hasKey = (k: string) => fields.value.some((f) => f.field_key === k);
const hasEventDates = computed(() => hasKey('event_start') && hasKey('event_end'));
const typeOptions = [
  { label: 'Short text', value: 'text' }, { label: 'Long text', value: 'textarea' }, { label: 'Number', value: 'number' },
  { label: 'Date', value: 'date' }, { label: 'One of a list', value: 'select' },
];

// A key is derived from the label so the captain never types one; the dashboard's two special keys are added by the button below.
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 48);

async function run(fn: () => Promise<void>, fallback: string) {
  busy.value = true; error.value = '';
  try { await fn(); await reload(); } catch (e) { error.value = errorMessage(e, fallback); } finally { busy.value = false; }
}

const add = () => run(async () => {
  let key = slug(label.value) || 'field';
  const base = key; let n = 2;
  while (hasKey(key)) key = `${base}_${n++}`;
  await createFieldDefinition({
    categoryId: props.category.id, key, label: label.value, type: type.value, required: required.value,
    options: type.value === 'select' ? options.value.split(',').map((o) => o.trim()).filter(Boolean) : null,
  });
  label.value = ''; options.value = ''; required.value = false; type.value = 'text';
}, 'Could not add the field.');

const addEventDates = () => run(async () => {
  if (!hasKey('event_start')) await createFieldDefinition({ categoryId: props.category.id, key: 'event_start', label: 'Event start date', type: 'date', required: true });
  if (!hasKey('event_end')) await createFieldDefinition({ categoryId: props.category.id, key: 'event_end', label: 'Event end date', type: 'date', required: true });
}, 'Could not add the event dates.');

const save = (f: FieldDefinition) => run(async () => { await updateFieldDefinition(f.id, editLabel.value, editRequired.value); editing.value = null; }, 'Could not save the field.');
</script>

<template>
  <Dialog v-model:open="open" :title="`Form fields — ${category.name}`" size="2xl" :actions="[{ label: 'Done', variant: 'subtle' }]">
    <div class="space-y-5">
      <p class="text-p-sm text-ink-gray-5">What a requester fills in when filing this category. Changing a field here changes the form for new requests only; answers already given stay as they are.</p>
      <ErrorMessage :message="error" />

      <div v-if="!hasEventDates" class="flex flex-wrap items-center justify-between gap-3 rounded-5 border bg-surface-blue-2 p-3">
        <p class="text-p-sm">The dashboard's <strong>events going on</strong> needs a start and end date on the request.</p>
        <Button variant="solid" size="sm" :loading="busy" @click="addEventDates">Add event dates</Button>
      </div>

      <p v-if="!fields.length" class="text-p-sm text-ink-gray-5">No fields yet — requests in this category only ask for a subject and details.</p>
      <ul class="divide-y divide-outline-gray-1">
        <li v-for="f in fields" :key="f.id" class="flex items-center justify-between gap-3 py-2 text-p-sm">
          <div v-if="editing === f.id" class="flex flex-1 items-center gap-3">
            <div class="flex-1"><FormControl v-model="editLabel" /></div>
            <Checkbox v-model="editRequired" label="Required" />
            <Button size="sm" variant="solid" :disabled="busy" @click="save(f)">Save</Button>
            <Button size="sm" @click="editing = null">Cancel</Button>
          </div>
          <template v-else>
            <div class="min-w-0">
              <span class="text-base-medium">{{ f.label }}</span>
              <Badge class="ml-2" :label="f.field_type" />
              <Badge v-if="f.is_required" class="ml-1" theme="amber" label="Required" />
              <span class="ml-2 font-mono text-xs text-ink-gray-5">{{ f.field_key }}</span>
            </div>
            <div class="flex-none">
              <Button variant="ghost" aria-label="Edit" @click="editing = f.id; editLabel = f.label; editRequired = f.is_required"><span class="lucide-pencil size-4" aria-hidden="true" /></Button>
              <Button variant="ghost" aria-label="Delete" @click="pending = f; showDelete = true"><span class="lucide-trash-2 size-4" aria-hidden="true" /></Button>
            </div>
          </template>
        </li>
      </ul>

      <form class="grid grid-cols-[1fr_9rem_auto] items-end gap-3" @submit.prevent="add">
        <FormControl v-model="label" label="New field" placeholder="Event name" required />
        <FormControl v-model="type" type="select" label="Type" :options="typeOptions" />
        <Button variant="solid" type="submit" :loading="busy">Add</Button>
        <div v-if="type === 'select'" class="col-span-3"><FormControl v-model="options" label="Choices, comma separated" placeholder="Hackathon, Workshop, Conference" /></div>
        <Checkbox v-model="required" label="Required" class="col-span-3" />
      </form>
    </div>
  </Dialog>
  <ConfirmDestructive
    v-if="pending" v-model:open="showDelete" title="Delete field" :record-name="pending.label"
    :description="`Removing &quot;${pending.label}&quot; also removes the answers already given to it.`"
    :on-confirmed="async () => { await adminDelete('field_definitions', pending!.id); await reload(); }"
  />
</template>
