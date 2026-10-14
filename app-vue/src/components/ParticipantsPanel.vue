<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Button, FormControl, ErrorMessage, Badge } from 'frappe-ui';
import type { UserContext } from '../lib/context';
import { type RequestRow, type CategoryInfo, getCategoryInfo, errorMessage } from '../lib/requests';
import { listParticipants, addParticipantByRegNo, respondToParticipation, type Participant } from '../lib/participants';

// Outstation participants (PRD-V2 §6): added by register number (RPC enforces
// the window and who may add), each accepts/declines their own place (RPC).
const props = defineProps<{ ctx: UserContext; request: RequestRow }>();

const category = ref<CategoryInfo | null>(null);
const participants = ref<Participant[]>([]);
const regNo = ref('');
const busy = ref(false);
const error = ref('');
const loaded = ref(false);

function load() {
  return Promise.all([getCategoryInfo(props.request.category_id), listParticipants(props.request.id)])
    .then(([c, p]) => { category.value = c; participants.value = p; })
    .catch(() => {})
    .finally(() => { loaded.value = true; });
}
watch(() => props.request.id, load, { immediate: true });

const until = computed(() => props.request.participants_open_until);
const afterApproval = computed(() => category.value?.participant_phase === 'after_approval');
const windowOpen = computed(() => afterApproval.value && !!until.value && new Date(until.value) > new Date());
const windowClosed = computed(() => afterApproval.value && !!until.value && new Date(until.value) <= new Date());
const canAdd = computed(() => category.value?.participant_phase === 'before_submit'
  ? props.request.requested_by === props.ctx.profile.id || props.ctx.isCaptain
  : windowOpen.value || props.ctx.isCaptain);
const visible = computed(() => loaded.value && !!category.value && (participants.value.length > 0 || canAdd.value));

const theme = (s: string) => (s === 'accepted' ? 'green' : s === 'declined' ? 'red' : 'amber');

async function run(fn: () => Promise<unknown>, fallback: string) {
  busy.value = true; error.value = '';
  try { await fn(); await load(); } catch (e) { error.value = errorMessage(e, fallback); } finally { busy.value = false; }
}
const add = () => regNo.value.trim()
  && run(async () => { await addParticipantByRegNo(props.request.id, regNo.value.trim()); regNo.value = ''; }, 'Could not add that participant.');
const respond = (id: string, accept: boolean) => run(() => respondToParticipation(id, accept), 'Could not record your response.');
</script>

<template>
  <div v-if="visible" class="space-y-2">
    <div class="text-sm text-ink-gray-5">Participants</div>
    <p v-if="afterApproval" class="text-p-sm text-ink-gray-5">
      <template v-if="windowOpen && until">Adding closes {{ new Date(until).toLocaleDateString() }}.</template>
      <template v-else-if="windowClosed">The window for adding participants has closed.</template>
      <template v-else-if="!until">Participants can be added once this request is approved.</template>
    </p>
    <ErrorMessage :message="error" />
    <ul class="divide-y divide-outline-gray-1">
      <li v-for="p in participants" :key="p.id" class="flex items-center justify-between gap-3 py-2 text-p-sm">
        <div>
          <span class="text-base-medium">{{ p.snapshot_name }}</span><span v-if="p.is_leader"> (leader)</span>
          <span class="ml-2 font-mono text-ink-gray-5">{{ p.snapshot_reg_no }}</span>
        </div>
        <div class="flex items-center gap-2">
          <Badge :theme="theme(p.acceptance_status)" :label="p.acceptance_status" />
          <template v-if="p.member_id === ctx.profile.id && p.acceptance_status === 'pending'">
            <Button size="sm" :disabled="busy" @click="respond(p.id, false)">Decline</Button>
            <Button size="sm" variant="solid" theme="green" :disabled="busy" @click="respond(p.id, true)">Accept</Button>
          </template>
        </div>
      </li>
    </ul>
    <form v-if="canAdd" class="flex items-end gap-2" @submit.prevent="add">
      <div class="min-w-0 flex-1"><FormControl v-model="regNo" placeholder="Register number" /></div>
      <Button type="submit" :disabled="busy">Add</Button>
    </form>
  </div>
</template>
