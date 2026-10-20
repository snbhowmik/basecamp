<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ErrorMessage } from 'frappe-ui';
import StatusBadge from './StatusBadge.vue';
import {
  listVisibleRequests, listClaimableRequestIds, errorMessage, type RequestRow,
} from '../lib/requests';
import { session } from '../lib/session';

const emit = defineEmits<{ count: [n: number] }>();

const ctx = computed(() => session.ctx!);
const rows = ref<RequestRow[]>([]);
const claimableIds = ref<Set<string>>(new Set());
const loading = ref(true);
const error = ref('');

const OPEN = ['submitted', 'in_review', 'changes_requested'];
onMounted(async () => {
  try {
    const [reqs, claimable] = await Promise.all([
      listVisibleRequests(), listClaimableRequestIds().catch(() => [] as string[]),
    ]);
    rows.value = reqs;
    claimableIds.value = new Set(claimable);
    emit('count', waiting.value.length + mine.value.length);
  } catch (e) { error.value = errorMessage(e, 'Could not load requests.'); }
  finally { loading.value = false; }
});

// "Waiting on you" is what is on your desk plus what is unclaimed and yours to
// claim — the second mentor on a class needs to see the ticket waiting for them.
const waiting = computed(() => rows.value.filter((r) =>
  !r.deleted_at && OPEN.includes(r.status)
  && (r.current_holder === ctx.value.profile.id || claimableIds.value.has(r.id))));
// A request the requester withdrew (deleted_at) is no longer pending, even though they still see it.
const mine = computed(() => rows.value.filter((r) => !r.deleted_at && r.requested_by === ctx.value.profile.id && OPEN.includes(r.status)));
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—');
const where = (r: RequestRow) => [r.holder?.full_name ? `With ${r.holder.full_name}` : 'Unassigned', r.stage?.name].filter(Boolean).join(' · ');
</script>

<template>
  <div class="space-y-8">
    <ErrorMessage :message="error" />
    <p v-if="loading" class="py-10 text-center text-p-sm text-ink-gray-5">Loading…</p>
    <template v-else>
      <section v-if="ctx.isStaff || waiting.length" class="space-y-2">
        <h2 class="text-lg-semibold">Waiting on you <span class="text-ink-gray-5">· {{ waiting.length }}</span></h2>
        <p v-if="!waiting.length" class="text-p-sm text-ink-gray-5">Nothing is waiting on you right now.</p>
        <ul v-else class="divide-y divide-outline-gray-1 rounded-6 border">
          <li v-for="r in waiting" :key="r.id">
            <router-link :to="{ path: '/requests', query: { open: r.id } }" class="flex items-center justify-between gap-3 px-3 py-3 hover:bg-surface-gray-1">
              <div class="min-w-0">
                <div class="truncate text-base-medium">{{ r.title || r.reference_number }}</div>
                <div class="text-p-sm text-ink-gray-5">{{ r.requester?.full_name ?? '—' }} · {{ r.request_categories?.name }} · filed {{ day(r.submitted_at ?? r.created_at) }}</div>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <span v-if="claimableIds.has(r.id)" class="rounded-full bg-surface-amber-2 px-1.5 py-0.5 text-xs text-ink-amber-8">To claim</span>
                <StatusBadge :status="r.status" />
              </div>
            </router-link>
          </li>
        </ul>
      </section>

      <section class="space-y-2">
        <h2 class="text-lg-semibold">Your requests in progress <span class="text-ink-gray-5">· {{ mine.length }}</span></h2>
        <div v-if="!mine.length" class="py-6 text-center">
          <div class="text-base-medium">No pending requests</div>
          <p class="text-p-sm text-ink-gray-5">Everything you've raised has been decided, or you haven't raised anything yet.</p>
        </div>
        <ul v-else class="divide-y divide-outline-gray-1 rounded-6 border">
          <li v-for="r in mine" :key="r.id">
            <router-link :to="{ path: '/requests', query: { open: r.id } }" class="flex items-center justify-between gap-3 px-3 py-3 hover:bg-surface-gray-1">
              <div class="min-w-0">
                <div class="truncate text-base-medium">{{ r.title || r.reference_number }}</div>
                <div class="text-p-sm text-ink-gray-5">{{ where(r) }} · filed {{ day(r.submitted_at ?? r.created_at) }}</div>
                <div v-if="r.status === 'changes_requested'" class="text-p-sm text-ink-amber-7">Changes were asked for — open it to see what.</div>
              </div>
              <StatusBadge :status="r.status" />
            </router-link>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
