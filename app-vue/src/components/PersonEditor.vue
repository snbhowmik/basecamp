<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Dialog, FormControl, Button, ErrorMessage, Badge } from 'frappe-ui';
import ConfirmDestructive from './ConfirmDestructive.vue';
import { listRoleAssignments, assignRole, setUserTags, setAccountActive, type RoleAssignmentRow } from '../lib/people';
import { adminDelete } from '../lib/admin';
import { listPriorityLevels, listTags, listOrgUnits } from '../lib/invites';
import type { AccountRow } from '../lib/org';
import type { PriorityLevel, Tag, OrgUnit } from '../lib/types';
import { errorMessage } from '../lib/requests';

// Roles are authority (level + scope + capacity; a person can hold several).
// Tags are membership. The 'admin' tag is the captaincy and is never shown or
// editable here — the database refuses it in both directions.
const props = defineProps<{ account: AccountRow }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ changed: [] }>();

const roles = ref<RoleAssignmentRow[]>([]);
const levels = ref<PriorityLevel[]>([]);
const tags = ref<Tag[]>([]);
const orgUnits = ref<OrgUnit[]>([]);
const selectedTags = ref<string[]>([]);
const busy = ref(false);
const error = ref('');
const msg = ref('');
const newLevel = ref('');
const newOrgUnit = ref('');
const newKind = ref('academic');
const removing = ref<RoleAssignmentRow | null>(null);
const showRemove = ref(false);
const showSuspend = ref(false);

async function reload() {
  const [r, l, t, o] = await Promise.all([listRoleAssignments(props.account.id), listPriorityLevels(), listTags(), listOrgUnits()]);
  roles.value = r;
  levels.value = l.filter((x) => !x.is_reserved);
  tags.value = t.filter((x) => x.code !== 'admin');
  orgUnits.value = o;
  selectedTags.value = props.account.tags.filter((c) => c !== 'admin');
}
watch(() => props.account.id, () => reload().catch((e) => { error.value = errorMessage(e, 'Could not load this account.'); }), { immediate: true });

async function run(fn: () => Promise<void>, ok: string) {
  busy.value = true; error.value = ''; msg.value = '';
  try { await fn(); await reload(); emit('changed'); msg.value = ok; }
  catch (e) { error.value = errorMessage(e, 'Something went wrong.'); }
  finally { busy.value = false; }
}

function addRole() {
  if (!newLevel.value) { error.value = 'Pick a level.'; return; }
  return run(async () => {
    await assignRole({
      userId: props.account.id, levelId: newLevel.value, orgUnitId: newOrgUnit.value || null,
      roleKind: newKind.value, isPrimary: roles.value.length === 0,
    });
    newLevel.value = ''; newOrgUnit.value = '';
  }, 'Role added.');
}

const toggleTag = (code: string) => {
  selectedTags.value = selectedTags.value.includes(code)
    ? selectedTags.value.filter((c) => c !== code) : [...selectedTags.value, code];
};

const levelOptions = computed(() => levels.value.map((l) => ({ label: l.name, value: l.id })));
const unitOptions = computed(() => [{ label: 'Instance-wide', value: '' }, ...orgUnits.value.map((o) => ({ label: o.name, value: o.id }))]);
const kindOptions = ['academic', 'club', 'event', 'admin'].map((k) => ({ label: k, value: k }));
</script>

<template>
  <Dialog v-model:open="open" :title="account.full_name" size="2xl" :actions="[{ label: 'Done', variant: 'subtle' }]">
    <div class="space-y-5">
      <ErrorMessage :message="error" />
      <p v-if="msg" class="text-p-sm text-ink-green-7">{{ msg }}</p>

      <dl class="grid grid-cols-[6rem_1fr] gap-y-2 text-p-sm">
        <dt class="text-ink-gray-5">Email</dt><dd class="font-mono">{{ account.email }}</dd>
        <dt class="text-ink-gray-5">Status</dt>
        <dd><Badge :theme="account.is_active ? 'green' : 'red'" :label="account.is_active ? 'Active' : 'Suspended'" /></dd>
      </dl>

      <section class="space-y-2">
        <h3 class="text-lg-semibold">Roles</h3>
        <p class="text-p-sm text-ink-gray-5">Authority comes from these. Someone can hold more than one — an academic role and a club role are different jobs with different scope.</p>
        <p v-if="!roles.length" class="text-p-sm text-ink-gray-5">No roles assigned — this account has no authority anywhere.</p>
        <ul class="divide-y divide-outline-gray-1">
          <li v-for="r in roles" :key="r.id" class="flex items-center justify-between gap-3 py-2 text-p-sm">
            <div>
              <span class="text-base-medium">{{ r.priority_levels?.name ?? '—' }}</span>
              <span class="ml-2 text-ink-gray-5">{{ r.org_units?.name ?? 'Instance-wide' }} · {{ r.role_kind }}</span>
              <Badge v-if="r.is_primary" class="ml-2" theme="blue" label="Primary" />
            </div>
            <Button variant="ghost" aria-label="Remove role" @click="removing = r; showRemove = true">
              <span class="lucide-trash-2 size-4" aria-hidden="true" />
            </Button>
          </li>
        </ul>
        <div class="grid grid-cols-3 items-end gap-2">
          <FormControl v-model="newLevel" type="select" label="Level" :options="levelOptions" />
          <FormControl v-model="newOrgUnit" type="select" label="Scope" :options="unitOptions" />
          <FormControl v-model="newKind" type="select" label="Kind" :options="kindOptions" />
        </div>
        <Button variant="solid" :disabled="busy" @click="addRole">Add role</Button>
      </section>

      <section class="space-y-2">
        <h3 class="text-lg-semibold">Tags</h3>
        <p class="text-p-sm text-ink-gray-5">Membership — which school, department or section this person belongs to. The captain tag is not editable here.</p>
        <div class="flex flex-wrap gap-2">
          <Button v-for="t in tags" :key="t.id" size="sm" :variant="selectedTags.includes(t.code) ? 'solid' : 'subtle'" @click="toggleTag(t.code)">{{ t.code }}</Button>
        </div>
        <Button variant="solid" :disabled="busy" @click="run(() => setUserTags(account.id, selectedTags), 'Tags updated.')">Save tags</Button>
      </section>

      <section class="space-y-2">
        <h3 class="text-lg-semibold">Account</h3>
        <Button v-if="account.is_active" theme="red" variant="subtle" :disabled="busy" @click="showSuspend = true">Suspend account</Button>
        <Button v-else :disabled="busy" @click="run(() => setAccountActive(account.id, true), 'Account restored.')">Restore account</Button>
      </section>
    </div>
  </Dialog>

  <ConfirmDestructive
    v-if="removing" v-model:open="showRemove" title="Remove role"
    :record-name="removing.priority_levels?.name ?? 'role'"
    :description="`Removing ${account.full_name}'s ${removing.priority_levels?.name ?? 'role'} assignment.`"
    :on-confirmed="async () => { await adminDelete('role_assignments', removing!.id); await reload(); emit('changed'); }"
  />
  <ConfirmDestructive
    v-model:open="showSuspend" title="Suspend account" :record-name="account.full_name"
    :description="`${account.full_name} will not be able to sign in. Their tickets and history stay intact.`"
    :on-confirmed="async () => { await setAccountActive(account.id, false); await reload(); emit('changed'); }"
  />
</template>
