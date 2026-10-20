<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMediaQuery, SMALL_SCREEN_QUERY } from '../lib/useMediaQuery';
import { Button, FormControl, ErrorMessage, Dropdown } from 'frappe-ui';
import AppHeader from '../components/AppHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import NewRequestDialog from '../components/NewRequestDialog.vue';
import RequestDetailDialog from '../components/RequestDetailDialog.vue';
import { session } from '../lib/session';
import {
  type RequestRow, type RequestCategory, listVisibleRequests, listCategories, errorMessage,
  listClaimableRequestIds,
} from '../lib/requests';

type Filter = 'all' | 'mine' | 'desk';

const ctx = computed(() => session.ctx!);
const route = useRoute();
const small = useMediaQuery(SMALL_SCREEN_QUERY);
const router = useRouter();
const requests = ref<RequestRow[]>([]);
const claimableIds = ref<Set<string>>(new Set());
const categories = ref<RequestCategory[]>([]);
const loading = ref(true);
const error = ref('');
const filter = ref<Filter>(ctx.value.isStaff ? 'desk' : 'mine');
const query = ref('');
const showNew = ref(false);
const newCategoryId = ref<string | undefined>();
const selected = ref<RequestRow | null>(null);
const showDetail = ref(false);

async function reload() {
  loading.value = true;
  try {
    const [reqs, cats, claimable] = await Promise.all([
      listVisibleRequests(), listCategories(),
      listClaimableRequestIds().catch(() => [] as string[]),
    ]);
    requests.value = reqs;
    claimableIds.value = new Set(claimable);
    categories.value = cats.filter((c) => c.is_active);
    // Keep an open detail dialog pointed at the fresh row, so a claim (which
    // changes current_holder) is reflected in the children that read the prop.
    if (selected.value) {
      const fresh = reqs.find((r) => r.id === selected.value!.id);
      if (fresh) selected.value = fresh;
    }
    error.value = '';
    // A link from the dashboard (`?open=<id>`) opens that request straight away.
    const want = typeof route.query.open === 'string' ? route.query.open : '';
    const hit = want ? reqs.find((r) => r.id === want) : undefined;
    if (hit && !showDetail.value) { filter.value = 'all'; selected.value = hit; showDetail.value = true; router.replace({ path: route.path }); }
  } catch (e) {
    error.value = errorMessage(e, 'Failed to load requests.');
  } finally {
    loading.value = false;
  }
}
onMounted(reload);

const visible = computed(() => {
  let rows = requests.value;
  const me = ctx.value.profile.id;
  if (filter.value === 'mine') rows = rows.filter((r) => r.requested_by === me);
  // "On my desk" is what you hold plus what is unclaimed and yours to claim.
  if (filter.value === 'desk') rows = rows.filter((r) => r.current_holder === me || claimableIds.value.has(r.id));
  const q = query.value.trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) =>
      r.title.toLowerCase().includes(q) || r.reference_number.toLowerCase().includes(q) ||
      (r.body ?? '').toLowerCase().includes(q));
  }
  return rows;
});

// Only leaf categories are fileable — a parent like "Tech" is a grouping.
const leafCategories = computed(() => {
  const parents = new Set(categories.value.map((c) => c.parent_id).filter(Boolean));
  return categories.value.filter((c) => !parents.has(c.id));
});

const createOptions = computed(() =>
  leafCategories.value.map((c) => ({
    label: c.name,
    onClick: () => { newCategoryId.value = c.id; showNew.value = true; },
  })));

const filters = computed(() => [
  ...(ctx.value.isStaff ? [{ key: 'desk' as Filter, label: 'On my desk' }] : []),
  { key: 'mine' as Filter, label: 'Raised by me' },
  { key: 'all' as Filter, label: 'All visible' },
]);

const emptyText = computed(() =>
  filter.value === 'desk' ? 'No requests are waiting on you right now.'
    : filter.value === 'mine' ? "You haven't raised any requests yet."
      : 'No requests are visible to you.');

function open(r: RequestRow) { selected.value = r; showDetail.value = true; }
</script>

<template>
  <AppHeader title="Requests">
    <template #actions>
      <Dropdown :options="createOptions" align="end">
        <Button variant="solid"><template #prefix><span class="lucide-plus size-4" aria-hidden="true" /></template>New<span class="hidden sm:inline">&nbsp;request</span></Button>
      </Dropdown>
    </template>
  </AppHeader>

  <div class="space-y-4 px-3 pb-10 pt-5 sm:px-5">
    <ErrorMessage :message="error" />
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex gap-2">
        <Button v-for="f in filters" :key="f.key" :variant="filter === f.key ? 'solid' : 'subtle'" size="sm" @click="filter = f.key">
          {{ f.label }}
        </Button>
      </div>
      <FormControl v-model="query" placeholder="Search requests…" class="w-56" />
    </div>

    <p v-if="loading" class="py-12 text-center text-p-sm text-ink-gray-5">Loading…</p>
    <div v-else-if="!visible.length" class="py-12 text-center">
      <div class="text-base-medium">Nothing here</div>
      <div class="text-p-sm text-ink-gray-5">{{ emptyText }}</div>
    </div>
    <!-- phone: a feed — title + meta, tall rows, tap to open (frappe-ui "Feed list": h-17 on mobile) -->
    <ul v-else-if="small" class="-mx-3 divide-y divide-outline-gray-1 border-y">
      <li v-for="r in visible" :key="r.id">
        <button type="button" class="flex min-h-17 w-full items-center justify-between gap-3 px-3 py-2.5 text-left active:bg-surface-gray-2" @click="open(r)">
          <div class="min-w-0">
            <div class="truncate text-lg text-ink-gray-9">{{ r.title || r.reference_number }}</div>
            <div class="mt-1.5 truncate text-md text-ink-gray-5">{{ r.request_categories?.name ?? '—' }} · {{ new Date(r.created_at).toLocaleDateString() }}</div>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <span v-if="r.deleted_at" class="rounded-full bg-surface-red-2 px-1.5 py-0.5 text-xs text-ink-red-7">Deleted</span>
            <span v-else-if="claimableIds.has(r.id)" class="rounded-full bg-surface-amber-2 px-1.5 py-0.5 text-xs text-ink-amber-8">To claim</span>
            <StatusBadge :status="r.status" />
          </div>
        </button>
      </li>
    </ul>
    <table v-else class="w-full text-left text-p-sm">
      <thead class="border-b text-ink-gray-5">
        <tr>
          <th class="py-2 font-normal">Reference</th><th class="font-normal">Subject</th>
          <th class="font-normal">Category</th><th v-if="filter !== 'mine'" class="font-normal">Requester</th>
          <th class="font-normal">Status</th><th class="font-normal">Created</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-gray-1">
        <tr v-for="r in visible" :key="r.id" class="cursor-pointer hover:bg-surface-gray-1" @click="open(r)">
          <td class="py-2.5 font-mono text-ink-gray-6">{{ r.reference_number }}</td>
          <td class="text-base-medium">{{ r.title }}</td>
          <td>{{ r.request_categories?.name ?? '—' }}</td>
          <td v-if="filter !== 'mine'">{{ r.requester?.full_name ?? '—' }}</td>
          <td>
            <div class="flex items-center gap-1.5">
              <StatusBadge :status="r.status" />
              <span v-if="r.deleted_at" class="rounded-full bg-surface-red-2 px-1.5 py-0.5 text-xs text-ink-red-7">Deleted</span>
              <span v-else-if="claimableIds.has(r.id)" class="rounded-full bg-surface-amber-2 px-1.5 py-0.5 text-xs text-ink-amber-8">To claim</span>
            </div>
          </td>
          <td class="tabular-nums text-ink-gray-6">{{ new Date(r.created_at).toLocaleDateString() }}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <NewRequestDialog
    v-if="showNew" v-model:open="showNew" :categories="leafCategories"
    :initial-category-id="newCategoryId" @created="reload"
  />
  <RequestDetailDialog
    v-if="selected" v-model:open="showDetail" :ctx="ctx" :request="selected"
    @changed="reload"
  />
</template>
