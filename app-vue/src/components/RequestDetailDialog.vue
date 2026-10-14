<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Dialog, FormControl, Button, ErrorMessage } from 'frappe-ui';
import StatusBadge from './StatusBadge.vue';
import StageTasks from './StageTasks.vue';
import ParticipantsPanel from './ParticipantsPanel.vue';
import Attachments from './Attachments.vue';
import DocumentView from './DocumentView.vue';
import TicketView from './TicketView.vue';
import { listTemplates } from '../lib/documents';
import { getOutstandingTaskCount } from '../lib/workflow';
import type { UserContext } from '../lib/context';
import {
  type RequestRow, type HistoryRow, type CommentRow, type FieldValue, type ForwardTarget,
  listHistory, listComments, listFieldValues, decideRequest, forwardRequest,
  searchForwardTargets, addComment, renderFieldValue, errorMessage, type DecisionAction,
} from '../lib/requests';

const props = defineProps<{ ctx: UserContext; request: RequestRow }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ changed: [] }>();

const history = ref<HistoryRow[]>([]);
const comments = ref<CommentRow[]>([]);
const fieldValues = ref<FieldValue[]>([]);
const note = ref('');
const commentBody = ref('');
const commentVisibility = ref<'public' | 'internal'>('public');
const error = ref('');
const busy = ref(false);
const outstanding = ref(0);
const docTypes = ref<string[]>([]);
const openDoc = ref<string | null>(null);
const showDoc = ref(false);
const showTicket = ref(false);
const showForward = ref(false);
const forwardQuery = ref('');
const forwardResults = ref<ForwardTarget[]>([]);

const isHolder = computed(() => props.request.current_holder === props.ctx.profile.id);
const isOpen = computed(() => !['approved', 'rejected', 'reviewed', 'closed'].includes(props.request.status));
const canAct = computed(() => isHolder.value && isOpen.value);

watch(() => props.request.id, (id) => {
  listHistory(id).then((h) => { history.value = h; }).catch(() => { history.value = []; });
  listComments(id).then((c) => { comments.value = c; }).catch(() => { comments.value = []; });
  listFieldValues(id).then((f) => { fieldValues.value = f; }).catch(() => { fieldValues.value = []; });
  refreshOutstanding();
  // Several versions of a template are normal; render_document() picks the newest.
  listTemplates(props.request.category_id)
    .then((t) => { docTypes.value = Array.from(new Set(t.map((x) => x.doc_type))); })
    .catch(() => { docTypes.value = []; });
}, { immediate: true });

const refreshOutstanding = () => getOutstandingTaskCount(props.request.id)
  .then((n) => { outstanding.value = n; }).catch(() => { outstanding.value = 0; });

let timer: ReturnType<typeof setTimeout> | undefined;
watch(forwardQuery, (q) => {
  clearTimeout(timer);
  if (!q.trim()) { forwardResults.value = []; return; }
  timer = setTimeout(() => {
    searchForwardTargets(q).then((r) => { forwardResults.value = r; }).catch(() => { forwardResults.value = []; });
  }, 250);
});

async function act(fn: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  try {
    await fn();
    emit('changed');
    open.value = false;
  } catch (e) {
    error.value = errorMessage(e, 'Action failed.');
  } finally {
    busy.value = false;
  }
}

const decide = (a: DecisionAction) => act(() => decideRequest(props.request.id, a, note.value));

const actions = computed(() => {
  if (!canAct.value) return [{ label: 'Close', variant: 'subtle' as const }];
  const list = [
    { label: 'Forward', variant: 'subtle' as const, onClick: () => { showForward.value = !showForward.value; } },
  ];
  if (props.request.decision_mode === 'log_only') {
    return [...list, { label: 'Mark reviewed', variant: 'solid' as const, theme: 'green' as const, onClick: () => decide('reviewed') }];
  }
  return [
    ...list,
    { label: 'Request changes', variant: 'subtle' as const, onClick: () => decide('changes_requested') },
    { label: 'Reject', variant: 'subtle' as const, theme: 'red' as const, onClick: () => decide('rejected') },
    {
      label: outstanding.value > 0 ? `Approve (${outstanding.value} task${outstanding.value === 1 ? '' : 's'} outstanding)` : 'Approve',
      variant: 'solid' as const, theme: 'green' as const, disabled: outstanding.value > 0, onClick: () => decide('approved'),
    },
  ];
});

async function postComment() {
  if (!commentBody.value.trim()) return;
  busy.value = true;
  error.value = '';
  try {
    await addComment(props.request.id, commentBody.value.trim(), commentVisibility.value);
    commentBody.value = '';
    comments.value = await listComments(props.request.id);
  } catch (e) {
    error.value = errorMessage(e, 'Could not post comment.');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open" :title="request.title" size="2xl" :actions="actions">
    <div class="space-y-5">
      <ErrorMessage :message="error" />

      <dl class="grid grid-cols-[8rem_1fr] gap-y-2 text-p-sm">
        <dt class="text-ink-gray-5">Reference</dt><dd class="font-mono">{{ request.reference_number }}</dd>
        <dt class="text-ink-gray-5">Status</dt><dd><StatusBadge :status="request.status" /></dd>
        <dt class="text-ink-gray-5">Category</dt><dd>{{ request.request_categories?.name ?? '—' }}</dd>
        <dt class="text-ink-gray-5">Requester</dt><dd>{{ request.requester?.full_name ?? '—' }}</dd>
        <template v-for="fv in fieldValues" :key="fv.id">
          <dt class="text-ink-gray-5">{{ fv.field_definitions?.label ?? fv.field_definitions?.field_key ?? 'Field' }}</dt>
          <dd>{{ renderFieldValue(fv.value) }}</dd>
        </template>
      </dl>

      <div v-if="docTypes.length" class="space-y-2">
        <div class="text-sm text-ink-gray-5">Documents</div>
        <div class="flex flex-wrap gap-2">
          <Button v-for="dt in docTypes" :key="dt" size="sm" @click="openDoc = dt; showDoc = true">
            <template #prefix><span class="lucide-file-text size-4" aria-hidden="true" /></template>{{ dt }}
          </Button>
          <Button v-if="request.status === 'approved'" size="sm" @click="showTicket = true">
            <template #prefix><span class="lucide-ticket size-4" aria-hidden="true" /></template>View as ticket
          </Button>
        </div>
      </div>

      <div v-if="request.body">
        <div class="mb-1 text-sm text-ink-gray-5">Details</div>
        <p class="whitespace-pre-wrap text-p-base">{{ request.body }}</p>
      </div>

      <StageTasks :ctx="ctx" :request="request" @saved="refreshOutstanding" />
      <ParticipantsPanel :ctx="ctx" :request="request" />
      <Attachments :request-id="request.id" :current-user-id="ctx.profile.id" />

      <div v-if="showForward && canAct" class="space-y-2 rounded-6 border p-3">
        <FormControl v-model="forwardQuery" label="Forward to" placeholder="Search by name or email…" />
        <button
          v-for="t in forwardResults" :key="t.user_id"
          class="block w-full rounded-4 px-2 py-1.5 text-left text-p-sm hover:bg-surface-gray-2"
          :disabled="busy"
          @click="act(() => forwardRequest(request.id, t.user_id, note))"
        >
          <strong>{{ t.full_name }}</strong> <span class="text-ink-gray-5">{{ t.email }}</span>
        </button>
      </div>

      <FormControl v-if="canAct" v-model="note" type="textarea" label="Note (attached to your decision)" />

      <div>
        <div class="mb-2 text-sm text-ink-gray-5">Activity</div>
        <p v-if="!history.length" class="text-p-sm text-ink-gray-5">No activity recorded.</p>
        <ul class="divide-y divide-outline-gray-1">
          <li v-for="h in history" :key="h.id" class="py-2">
            <div class="text-base-medium capitalize">{{ h.action.replace('_', ' ') }}</div>
            <div v-if="h.note" class="text-p-sm">{{ h.note }}</div>
            <div class="text-xs text-ink-gray-5 tabular-nums">{{ new Date(h.created_at).toLocaleString() }}</div>
          </li>
        </ul>
      </div>

      <div class="space-y-2">
        <div class="text-sm text-ink-gray-5">Comments</div>
        <div v-for="c in comments" :key="c.id" class="rounded-4 border bg-surface-gray-1 p-2.5">
          <div class="flex justify-between gap-3">
            <span class="whitespace-pre-wrap text-p-sm">{{ c.body }}</span>
            <span v-if="c.visibility === 'internal'" class="text-xs text-ink-amber-7">Internal</span>
          </div>
          <div class="text-xs text-ink-gray-5 tabular-nums">{{ new Date(c.created_at).toLocaleString() }}</div>
        </div>
        <div class="flex items-end gap-2">
          <div class="min-w-0 flex-1">
            <FormControl v-model="commentBody" placeholder="Add a comment…" />
          </div>
          <div v-if="ctx.isStaff" class="w-32 shrink-0">
            <FormControl
              v-model="commentVisibility" type="select"
              :options="[{ label: 'Public', value: 'public' }, { label: 'Internal', value: 'internal' }]"
            />
          </div>
          <Button :disabled="busy || !commentBody.trim()" @click="postComment">Post</Button>
        </div>
      </div>
    </div>
  </Dialog>
  <DocumentView v-if="openDoc" v-model:open="showDoc" :request-id="request.id" :doc-type="openDoc" />
  <TicketView v-if="showTicket && docTypes[0]" v-model:open="showTicket" :request-id="request.id" :doc-type="docTypes[0]" :request="request" />
</template>
