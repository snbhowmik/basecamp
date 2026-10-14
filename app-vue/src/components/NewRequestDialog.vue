<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Dialog, FormControl, ErrorMessage } from 'frappe-ui';
import ReceiptPrinter from './ReceiptPrinter.vue';
import {
  type RequestCategory, type FieldDefinition, type FirstHopCandidate,
  listFirstHopCandidates, listFieldDefinitions, submitRequest, saveFieldValues, getRequest, type RequestRow,
  coerceFieldValue, fieldOptions, errorMessage,
} from '../lib/requests';

const props = defineProps<{ categories: RequestCategory[]; initialCategoryId?: string }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ created: [requestId: string] }>();

const categoryId = ref(props.initialCategoryId ?? '');
const title = ref('');
const body = ref('');
const fieldDefs = ref<FieldDefinition[]>([]);
const fieldValues = ref<Record<string, string>>({});
const candidates = ref<FirstHopCandidate[]>([]);
const firstHop = ref('');
const submitting = ref(false);
// The receipt printer opens the moment submitting starts and prints once the request truly exists.
const printing = ref(false);
const receipt = ref<RequestRow | null>(null);
const createdId = ref('');
const error = ref('');

// Form is built from whatever the captain configured for the picked category.
watch(categoryId, async (id) => {
  candidates.value = [];
  firstHop.value = '';
  fieldDefs.value = [];
  fieldValues.value = {};
  if (!id) return;
  listFirstHopCandidates(id)
    .then((c) => { candidates.value = c; firstHop.value = c[0]?.user_id ?? ''; })
    .catch(() => { candidates.value = []; });
  listFieldDefinitions(id).then((d) => { fieldDefs.value = d; }).catch(() => { fieldDefs.value = []; });
}, { immediate: true });

const categoryOptions = computed(() => props.categories.map((c) => ({ label: c.name, value: c.id })));
const hopOptions = computed(() => candidates.value.map((c) => ({ label: `${c.full_name} — ${c.option_label}`, value: c.user_id })));

async function submit() {
  error.value = '';
  if (!categoryId.value) { error.value = 'Pick a category.'; return; }
  if (!title.value.trim()) { error.value = 'Add a subject.'; return; }
  const missing = fieldDefs.value.filter((d) => d.is_required && !(fieldValues.value[d.id] ?? '').trim());
  if (missing.length) { error.value = `Required: ${missing.map((d) => d.label).join(', ')}.`; return; }
  submitting.value = true;
  printing.value = true; receipt.value = null;
  try {
    const id = await submitRequest({
      categoryId: categoryId.value, title: title.value, body: body.value, firstHop: firstHop.value || null,
    });
    // Second write: the RPC takes only the fixed columns. If this fails the
    // request still exists — surfaced rather than swallowed.
    await saveFieldValues(id, fieldDefs.value.map((d) => ({
      definitionId: d.id, value: coerceFieldValue(d, fieldValues.value[d.id]),
    })));
    createdId.value = id;
    receipt.value = await getRequest(id);
    // The request exists either way; if it cannot be re-read there is nothing to print.
    if (!receipt.value) { printing.value = false; emit('created', id); open.value = false; }
  } catch (e) {
    printing.value = false;
    error.value = errorMessage(e, 'Could not submit the request.');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Dialog
    v-model:open="open"
    title="New request"
    size="xl"
    :actions="[{ label: 'Submit request', variant: 'solid', loading: submitting, onClick: submit }]"
  >
    <div class="space-y-4">
      <ErrorMessage :message="error" />
      <FormControl v-model="categoryId" type="select" label="Category" :options="categoryOptions" />
      <p v-if="!categories.length" class="text-p-sm text-ink-gray-5">
        No categories are configured yet. The captain sets these up on the Workflow page.
      </p>
      <FormControl v-model="title" label="Subject" placeholder="Short summary of what you're requesting" />
      <FormControl v-model="body" type="textarea" label="Details" placeholder="Anything the approver needs to know" />

      <template v-for="d in fieldDefs" :key="d.id">
        <FormControl
          v-if="d.field_type === 'select'"
          v-model="fieldValues[d.id]" type="select" :label="d.label + (d.is_required ? ' *' : '')"
          :options="fieldOptions(d)"
        />
        <FormControl
          v-else-if="d.field_type === 'textarea'"
          v-model="fieldValues[d.id]" type="textarea" :label="d.label + (d.is_required ? ' *' : '')"
        />
        <FormControl
          v-else
          v-model="fieldValues[d.id]"
          :type="d.field_type === 'date' ? 'date' : d.field_type === 'number' ? 'number' : 'text'"
          :label="d.label + (d.is_required ? ' *' : '')"
        />
      </template>

      <template v-if="categoryId">
        <FormControl v-if="candidates.length" v-model="firstHop" type="select" label="Send to" :options="hopOptions" />
        <p v-else class="text-p-sm text-ink-gray-5">
          No recipients are configured for this category yet — it'll be submitted unassigned and someone with
          access will need to pick it up. Your mentor and HOD are added as watchers automatically either way.
        </p>
      </template>
    </div>
  </Dialog>

  <ReceiptPrinter v-if="printing" :request="receipt" @done="printing = false; emit('created', createdId); open = false" />
</template>
