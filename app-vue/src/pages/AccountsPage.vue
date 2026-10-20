<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { FormControl, ErrorMessage, Badge } from 'frappe-ui';
import AppHeader from '../components/AppHeader.vue';
import PersonEditor from '../components/PersonEditor.vue';
import { listAccounts, type AccountRow } from '../lib/org';
import { errorMessage } from '../lib/requests';

// The captain's roster of every account. Every change goes through an RPC —
// the rules about who may hold what authority belong in the database.
const accounts = ref<AccountRow[]>([]);
const loading = ref(true);
const error = ref('');
const query = ref('');
const editing = ref<AccountRow | null>(null);
const showEditor = ref(false);

async function reload() {
  try {
    accounts.value = await listAccounts();
    if (editing.value) editing.value = accounts.value.find((a) => a.id === editing.value!.id) ?? null;
  } catch (e) { error.value = errorMessage(e, 'Failed to load accounts.'); }
}
onMounted(() => reload().finally(() => { loading.value = false; }));

const visible = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return accounts.value;
  return accounts.value.filter((a) =>
    a.full_name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q) || a.tags.some((t) => t.includes(q)));
});
</script>

<template>
  <AppHeader title="Accounts" />
  <div class="space-y-4 px-3 pb-10 pt-5 sm:px-5">
    <p class="text-p-sm text-ink-gray-5">Everyone with an account on this instance. Select a row to change roles, tags, or access.</p>
    <ErrorMessage :message="error" />
    <div class="flex items-center justify-between gap-3">
      <span class="text-p-sm text-ink-gray-5">{{ visible.length }} of {{ accounts.length }} accounts</span>
      <FormControl v-model="query" placeholder="Search name, email, or tag…" class="w-64" />
    </div>
    <p v-if="loading" class="py-12 text-center text-p-sm text-ink-gray-5">Loading…</p>
    <p v-else-if="!visible.length" class="py-12 text-center text-base-medium">No accounts found</p>
    <div v-else class="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
    <table class="w-full text-left text-p-sm">
      <thead class="border-b text-ink-gray-5">
        <tr><th class="py-2 font-normal">Name</th><th class="font-normal">Level</th><th class="font-normal">Tags</th><th class="font-normal">MFA</th><th class="font-normal">Status</th><th class="font-normal">Joined</th></tr>
      </thead>
      <tbody class="divide-y divide-outline-gray-1">
        <tr v-for="a in visible" :key="a.id" class="cursor-pointer hover:bg-surface-gray-1" @click="editing = a; showEditor = true">
          <td class="py-2.5"><div class="text-base-medium">{{ a.full_name }}</div><div class="font-mono text-xs text-ink-gray-5">{{ a.email }}</div></td>
          <td>{{ a.levelNames.length ? a.levelNames.join(', ') : '—' }}</td>
          <td><div class="flex flex-wrap gap-1"><span v-if="!a.tags.length">—</span><Badge v-for="t in a.tags" :key="t" :label="t" /></div></td>
          <td><Badge :theme="a.mfa_enrolled ? 'green' : 'amber'" :label="a.mfa_enrolled ? 'Enrolled' : 'Pending'" /></td>
          <td><Badge :theme="a.is_active ? 'green' : 'gray'" :label="a.is_active ? 'Active' : 'Inactive'" /></td>
          <td class="tabular-nums text-ink-gray-6">{{ new Date(a.created_at).toLocaleDateString() }}</td>
        </tr>
      </tbody>
    </table>
</div>
  </div>
  <PersonEditor v-if="editing" v-model:open="showEditor" :account="editing" @changed="reload" />
</template>
