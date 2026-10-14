<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { DonutChart, NumberCard } from 'frappe-ui/charts';
import { ErrorMessage } from 'frappe-ui';
import StatusBadge from './StatusBadge.vue';
import { listVisibleRequests, errorMessage, type RequestRow } from '../lib/requests';
import { OUTCOME } from '../dashboard/widgets';
import { session } from '../lib/session';

// A person's own requests at a glance — what they raised and how it went.
const ctx = computed(() => session.ctx!);
const all = ref<RequestRow[]>([]);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try { all.value = await listVisibleRequests(); }
  catch (e) { error.value = errorMessage(e, 'Could not load requests.'); }
  finally { loading.value = false; }
});

const mine = computed(() => all.value.filter((r) => r.requested_by === ctx.value.profile.id));
const count = (f: (r: RequestRow) => boolean) => mine.value.filter(f).length;
const approved = computed(() => count((r) => ['approved', 'reviewed'].includes(r.status)));
const rejected = computed(() => count((r) => r.status === 'rejected'));
const changes = computed(() => count((r) => r.status === 'changes_requested'));
const inProgress = computed(() => count((r) => ['submitted', 'in_review'].includes(r.status)));

// Pinned per outcome, zero slices dropped, palette built from the same rows.
const slices = computed(() => [
  { name: OUTCOME.approved.label, count: approved.value, color: OUTCOME.approved.color },
  { name: OUTCOME.in_progress.label, count: inProgress.value + changes.value, color: OUTCOME.in_progress.color },
  { name: OUTCOME.rejected.label, count: rejected.value, color: OUTCOME.rejected.color },
].filter((s) => s.count > 0));

const byCategory = computed(() => {
  const m = new Map<string, number>();
  for (const r of mine.value) { const n = r.request_categories?.name ?? 'Other'; m.set(n, (m.get(n) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
});
const recent = computed(() => [...mine.value].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 6));
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
</script>

<template>
  <div class="space-y-6">
    <ErrorMessage :message="error" />
    <p v-if="loading" class="py-10 text-center text-p-sm text-ink-gray-5">Loading…</p>
    <div v-else-if="!mine.length" class="py-10 text-center">
      <div class="text-base-medium">No requests yet</div>
      <p class="mb-3 text-p-sm text-ink-gray-5">Raise your first request to see a summary here.</p>
      <router-link to="/requests" class="text-ink-blue-link underline">Go to Requests</router-link>
    </div>
    <template v-else>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div class="rounded-6 border bg-surface-base p-1"><NumberCard title="Raised" :value="mine.length" :card="false" /></div>
        <div class="rounded-6 border bg-surface-base p-1"><NumberCard title="Approved" :value="approved" :card="false" /></div>
        <div class="rounded-6 border bg-surface-base p-1"><NumberCard title="In progress" :value="inProgress + changes" :card="false" /></div>
        <div class="rounded-6 border bg-surface-base p-1"><NumberCard title="Rejected" :value="rejected" :card="false" /></div>
      </div>

      <div class="grid gap-4 lg:grid-cols-3">
        <div class="h-72 rounded-6 border bg-surface-base p-1">
          <DonutChart title="How they turned out" :data="slices" category="name" value="count" :palette="slices.map((s) => s.color)" center-label="requests" :show-data-labels="false" />
        </div>
        <section class="space-y-2 rounded-6 border p-3">
          <h2 class="text-base-medium">By category</h2>
          <ul class="divide-y divide-outline-gray-1">
            <li v-for="[name, n] in byCategory" :key="name" class="flex justify-between py-2 text-p-sm"><span>{{ name }}</span><span class="tabular-nums text-ink-gray-6">{{ n }}</span></li>
          </ul>
        </section>
        <section class="space-y-2 rounded-6 border p-3">
          <h2 class="text-base-medium">Latest</h2>
          <ul class="divide-y divide-outline-gray-1">
            <li v-for="r in recent" :key="r.id">
              <router-link :to="{ path: '/requests', query: { open: r.id } }" class="flex items-center justify-between gap-2 py-2 hover:bg-surface-gray-1">
                <div class="min-w-0"><div class="truncate text-p-sm text-ink-gray-8">{{ r.title || r.reference_number }}</div><div class="text-xs text-ink-gray-5">{{ day(r.created_at) }}</div></div>
                <StatusBadge :status="r.status" />
              </router-link>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </div>
</template>
