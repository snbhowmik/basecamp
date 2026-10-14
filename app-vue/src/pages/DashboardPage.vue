<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { PageHeader, PageHeaderTitle, Button, ErrorMessage, Badge } from 'frappe-ui';
import StatCard from '../components/StatCard.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { session } from '../lib/session';
import { listVisibleRequests, type RequestRow, errorMessage } from '../lib/requests';
import { listAccounts, type AccountRow } from '../lib/org';
import { listMyInvites } from '../lib/invites';

// The captain's dashboard is about the org (who's joined, who's outstanding);
// everyone else's is about their own queue.
const ctx = computed(() => session.ctx!);
const requests = ref<RequestRow[]>([]);
const accounts = ref<AccountRow[]>([]);
const pendingInvites = ref(0);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    if (ctx.value.isCaptain) {
      const [acc, inv] = await Promise.all([listAccounts(), listMyInvites()]);
      accounts.value = acc;
      pendingInvites.value = inv.filter((i) => !i.consumed_at).length;
    } else {
      requests.value = await listVisibleRequests();
    }
  } catch (e) { error.value = errorMessage(e, 'Failed to load dashboard.'); }
  finally { loading.value = false; }
});

const title = computed(() => ctx.value.isCaptain ? 'Organisation overview' : `Welcome back, ${ctx.value.profile.full_name.split(' ')[0]}`);
const lede = computed(() => ctx.value.isCaptain ? 'Accounts, invitations, and the shape of the org.' : 'Your requests and anything waiting on you.');

// member_type is the record, not a hardcoded tag list (that list had no 'ascdean' or 'club').
const staff = computed(() => accounts.value.filter((a) => a.memberType === 'staff'));
const students = computed(() => accounts.value.filter((a) => a.memberType === 'student').length);
// A brand-new org is every deployment's first screen: until somebody else exists, lead with the path, not counters.
const isFreshOrg = computed(() => accounts.value.length <= 1 && pendingInvites.value === 0);

const mine = computed(() => requests.value.filter((r) => r.requested_by === ctx.value.profile.id));
const onMyDesk = computed(() => requests.value.filter((r) => r.current_holder === ctx.value.profile.id));
const pending = computed(() => mine.value.filter((r) => ['submitted', 'in_review'].includes(r.status)).length);
const approved = computed(() => mine.value.filter((r) => ['approved', 'reviewed'].includes(r.status)).length);
const rejected = computed(() => mine.value.filter((r) => r.status === 'rejected').length);
const changes = computed(() => mine.value.filter((r) => r.status === 'changes_requested').length);
</script>

<template>
  <PageHeader><PageHeaderTitle :title="title" /></PageHeader>
  <p v-if="loading" class="py-12 text-center text-p-sm text-ink-gray-5">Loading…</p>
  <div v-else class="space-y-6 p-5">
    <p class="text-p-sm text-ink-gray-5">{{ lede }}</p>
    <ErrorMessage :message="error" />

    <!-- captain, brand-new org -->
    <template v-if="ctx.isCaptain && isFreshOrg">
      <ol class="space-y-4">
        <li class="flex gap-3">
          <span class="flex size-6 flex-none items-center justify-center rounded-full bg-surface-gray-3 text-sm">1</span>
          <div class="space-y-1">
            <div class="text-base-medium">Create your departments and batches</div>
            <p class="text-p-sm text-ink-gray-5">Students pick these when they register, so nobody can sign up until at least one exists.</p>
            <Button variant="solid" size="sm" route="/workflow">Open Workflow</Button>
          </div>
        </li>
        <li class="flex gap-3">
          <span class="flex size-6 flex-none items-center justify-center rounded-full bg-surface-gray-3 text-sm">2</span>
          <div class="space-y-1">
            <div class="text-base-medium">Invite the people above department level</div>
            <p class="text-p-sm text-ink-gray-5">Deans and HODs. Each invitee gets a link by email and sets their own password and authenticator.</p>
            <Button size="sm" route="/invite">Send an invite</Button>
          </div>
        </li>
        <li class="flex gap-3">
          <span class="flex size-6 flex-none items-center justify-center rounded-full bg-surface-gray-3 text-sm">3</span>
          <div class="space-y-1">
            <div class="text-base-medium">They build out the rest</div>
            <p class="text-p-sm text-ink-gray-5">An HOD invites their own mentors; students self-register against a department and batch. You do not create those accounts yourself.</p>
          </div>
        </li>
      </ol>
      <section class="space-y-2">
        <div class="flex items-center justify-between"><h2 class="text-lg-semibold">Your account</h2><Button size="sm" route="/accounts">View all accounts</Button></div>
        <dl v-for="a in accounts" :key="a.id" class="grid grid-cols-[6rem_1fr] gap-y-1 text-p-sm">
          <dt class="text-ink-gray-5">Name</dt><dd>{{ a.full_name }}</dd>
          <dt class="text-ink-gray-5">Email</dt><dd class="font-mono">{{ a.email }}</dd>
          <dt class="text-ink-gray-5">Level</dt><dd>{{ a.levelNames.join(', ') || '—' }}</dd>
        </dl>
      </section>
    </template>

    <!-- captain, org with people -->
    <template v-else-if="ctx.isCaptain">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon="lucide-users" label="Total accounts" :value="accounts.length" />
        <StatCard icon="lucide-users" label="Staff & faculty" :value="staff.length" />
        <StatCard icon="lucide-graduation-cap" label="Students" :value="students" />
        <StatCard icon="lucide-mail-plus" label="Invites pending" :value="pendingInvites" />
      </div>
      <section class="space-y-2">
        <div class="flex items-center justify-between"><h2 class="text-lg-semibold">Staff &amp; faculty</h2><Button size="sm" route="/accounts">View all accounts</Button></div>
        <div v-if="!staff.length" class="py-8 text-center">
          <div class="text-base-medium">No staff accounts yet</div>
          <p class="mb-2 text-p-sm text-ink-gray-5">Invite a Dean or HOD to start building out the org.</p>
          <Button variant="solid" size="sm" route="/invite">Send an invite</Button>
        </div>
        <table v-else class="w-full text-left text-p-sm">
          <thead class="border-b text-ink-gray-5"><tr><th class="py-2 font-normal">Name</th><th class="font-normal">Level</th><th class="font-normal">Tags</th><th class="font-normal">Joined</th></tr></thead>
          <tbody class="divide-y divide-outline-gray-1">
            <tr v-for="a in staff.slice(0, 8)" :key="a.id">
              <td class="py-2.5"><div class="text-base-medium">{{ a.full_name }}</div><div class="font-mono text-xs text-ink-gray-5">{{ a.email }}</div></td>
              <td>{{ a.levelNames.length ? a.levelNames.join(', ') : '—' }}</td>
              <td><div class="flex flex-wrap gap-1"><Badge v-for="t in a.tags.filter((x) => !x.startsWith('org:'))" :key="t" :label="t" /></div></td>
              <td class="tabular-nums text-ink-gray-6">{{ new Date(a.created_at).toLocaleDateString() }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <!-- everyone else -->
    <template v-else>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon="lucide-clock" label="Pending" :value="pending" />
        <StatCard icon="lucide-circle-check" label="Approved" :value="approved" />
        <StatCard icon="lucide-circle-x" label="Rejected" :value="rejected" />
        <StatCard v-if="ctx.isStaff" icon="lucide-inbox" label="Awaiting my action" :value="onMyDesk.length" />
        <StatCard v-else icon="lucide-inbox" label="Needs changes" :value="changes" />
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <section v-if="ctx.isStaff" class="space-y-2">
          <div class="flex items-center justify-between"><h2 class="text-lg-semibold">Awaiting your action</h2><Button size="sm" route="/requests">Open queue</Button></div>
          <div v-if="!onMyDesk.length" class="py-6 text-center">
            <div class="text-base-medium">Nothing waiting on you</div>
            <p class="text-p-sm text-ink-gray-5">Requests forwarded to you will appear here.</p>
          </div>
          <router-link v-for="r in onMyDesk.slice(0, 6)" :key="r.id" to="/requests" class="flex items-center justify-between gap-3 rounded-4 px-2 py-2 hover:bg-surface-gray-1">
            <div><div class="text-base-medium">{{ r.title }}</div><div class="font-mono text-xs text-ink-gray-5">{{ r.reference_number }}</div></div>
            <StatusBadge :status="r.status" />
          </router-link>
        </section>

        <section class="space-y-2">
          <div class="flex items-center justify-between"><h2 class="text-lg-semibold">My recent requests</h2><Button size="sm" route="/requests">View all</Button></div>
          <div v-if="!mine.length" class="py-6 text-center">
            <div class="text-base-medium">No requests yet</div>
            <p class="mb-2 text-p-sm text-ink-gray-5">Raise your first request to get started.</p>
            <Button variant="solid" size="sm" route="/requests">New request</Button>
          </div>
          <router-link v-for="r in mine.slice(0, 6)" :key="r.id" to="/requests" class="flex items-center justify-between gap-3 rounded-4 px-2 py-2 hover:bg-surface-gray-1">
            <div><div class="text-base-medium">{{ r.title }}</div><div class="font-mono text-xs text-ink-gray-5">{{ r.reference_number }}</div></div>
            <StatusBadge :status="r.status" />
          </router-link>
        </section>
      </div>
    </template>

    <!-- every dashboard opens onto the board: "who is above and below me" shouldn't need nav knowledge -->
    <section v-if="!ctx.isCaptain || !isFreshOrg" class="flex items-center justify-between gap-3 rounded-6 border p-4">
      <div><h2 class="text-lg-semibold">Organisation</h2><p class="text-p-sm text-ink-gray-5">The ladder, read top to bottom, one rung per level. Choose somebody to narrow the rungs below them to their people.</p></div>
      <Button route="/hierarchy">Open the board</Button>
    </section>
  </div>
</template>
