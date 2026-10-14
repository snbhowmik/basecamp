<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { FormControl, Button, ErrorMessage } from 'frappe-ui';
import ConfirmDestructive from './ConfirmDestructive.vue';
import { listOrgUnits, createOrgUnit, listAllBatches, createBatch, updateBatch, renameOrgUnit } from '../lib/org';
import { adminDelete, type DeletableTable } from '../lib/admin';
import type { OrgUnit, OrgUnitType, Batch } from '../lib/types';
import { errorMessage } from '../lib/requests';

// Org units (faculty -> programme) and batches. Creation/rename/update are RPCs
// (an org unit also creates its scope tag; two client inserts would orphan on
// partial failure). Deletion goes through admin_delete behind ConfirmDestructive.
const orgUnits = ref<OrgUnit[]>([]);
const batches = ref<Batch[]>([]);
const loading = ref(true);
const error = ref('');
const busy = ref(false);

const unitName = ref('');
const unitCode = ref('');
const unitType = ref<OrgUnitType>('faculty');
const unitParent = ref('');
const batchUnit = ref('');
const batchStart = ref('');
const batchEnd = ref('');
const batchPrefix = ref('');

const editUnit = ref<string | null>(null);
const editUnitName = ref('');
const editBatch = ref<string | null>(null);
const editBatchStart = ref('');
const editBatchEnd = ref('');
const editBatchPrefix = ref('');

const pending = ref<{ table: DeletableTable; id: string; name: string } | null>(null);
const showDelete = ref(false);

async function reload() {
  try {
    const [d, b] = await Promise.all([listOrgUnits(), listAllBatches()]);
    orgUnits.value = d; batches.value = b;
  } catch (e) { error.value = errorMessage(e, 'Failed to load.'); }
  finally { loading.value = false; }
}
onMounted(reload);

async function run(fn: () => Promise<void>, fallback: string) {
  busy.value = true; error.value = '';
  try { await fn(); await reload(); } catch (e) { error.value = errorMessage(e, fallback); } finally { busy.value = false; }
}

const addUnit = () => run(async () => {
  await createOrgUnit(unitName.value, unitCode.value, unitType.value, unitParent.value || null);
  unitName.value = ''; unitCode.value = ''; unitParent.value = '';
}, 'Could not create org unit.');

// Name omitted on purpose — create_batch() derives "<start>-<end>".
const addBatch = () => run(async () => {
  await createBatch(batchUnit.value, null, Number(batchStart.value), Number(batchEnd.value), 'FT', batchPrefix.value.trim() || null);
  batchStart.value = ''; batchEnd.value = ''; batchPrefix.value = '';
}, 'Could not create batch.');

const saveUnit = (id: string) => run(async () => { await renameOrgUnit(id, editUnitName.value); editUnit.value = null; }, 'Could not rename the org unit.');

// A blank prefix clears it on purpose: an intake whose numbering isn't settled should accept anything.
const saveBatch = (id: string) => run(async () => {
  await updateBatch({ id, startYear: Number(editBatchStart.value), endYear: Number(editBatchEnd.value), regNoPrefix: editBatchPrefix.value.trim() || null });
  editBatch.value = null;
}, 'Could not update the batch.');

function askDelete(table: DeletableTable, id: string, name: string) { pending.value = { table, id, name }; showDelete.value = true; }

const faculties = computed(() => orgUnits.value.filter((u) => u.unit_type === 'faculty').map((u) => ({ label: u.name, value: u.id })));
const unitOptions = computed(() => orgUnits.value.map((u) => ({ label: u.name, value: u.id })));
const typeOptions = [{ label: 'Faculty / school', value: 'faculty' }, { label: 'Programme', value: 'programme' }];
const batchName = computed(() => batchStart.value && batchEnd.value ? `${batchStart.value}-${batchEnd.value}` : '<start>-<end>');
</script>

<template>
  <p v-if="loading" class="py-12 text-center text-p-sm text-ink-gray-5">Loading…</p>
  <div v-else class="space-y-6">
    <ErrorMessage :message="error" />

    <div class="grid gap-8 lg:grid-cols-2">
      <section class="space-y-4">
        <h2 class="text-lg-semibold">Org units</h2>
        <form class="grid grid-cols-2 items-end gap-3" @submit.prevent="addUnit">
          <FormControl v-model="unitName" label="Name" placeholder="Computer Science and Engineering" required />
          <FormControl v-model="unitCode" label="Short code" placeholder="cse" required />
          <FormControl v-model="unitType" type="select" label="Type" :options="typeOptions" @update:model-value="unitType === 'faculty' && (unitParent = '')" />
          <FormControl v-model="unitParent" type="select" label="Parent faculty" :options="[{ label: unitType === 'programme' ? 'Top level' : 'Not applicable', value: '' }, ...faculties]" :disabled="unitType !== 'programme'" />
          <Button variant="solid" type="submit" :loading="busy" class="col-span-2">Add org unit</Button>
        </form>

        <p v-if="!orgUnits.length" class="text-p-sm text-ink-gray-5">No org units yet. Add one above — students pick from these when they register.</p>
        <table v-else class="w-full text-left text-p-sm">
          <thead class="border-b text-ink-gray-5"><tr><th class="py-2 font-normal">Org unit</th><th class="font-normal">Type</th><th class="font-normal">Code</th><th /></tr></thead>
          <tbody class="divide-y divide-outline-gray-1">
            <tr v-for="d in orgUnits" :key="d.id">
              <td class="py-2">
                <FormControl v-if="editUnit === d.id" v-model="editUnitName" />
                <span v-else class="text-base-medium">{{ d.name }}</span>
              </td>
              <td>{{ d.unit_type === 'faculty' ? 'Faculty' : 'Programme' }}</td>
              <td class="font-mono">{{ d.code }}</td>
              <td class="text-right">
                <template v-if="editUnit === d.id">
                  <Button size="sm" variant="solid" :disabled="busy" @click="saveUnit(d.id)">Save</Button>
                  <Button size="sm" class="ml-1" @click="editUnit = null">Cancel</Button>
                </template>
                <template v-else>
                  <Button variant="ghost" aria-label="Rename" @click="editUnit = d.id; editUnitName = d.name"><span class="lucide-pencil size-4" aria-hidden="true" /></Button>
                  <Button variant="ghost" aria-label="Delete" @click="askDelete('org_units', d.id, d.name)"><span class="lucide-trash-2 size-4" aria-hidden="true" /></Button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="space-y-4">
        <h2 class="text-lg-semibold">Batches</h2>
        <form class="space-y-3" @submit.prevent="addBatch">
          <FormControl v-model="batchUnit" type="select" label="Org unit" :options="unitOptions" />
          <div class="grid grid-cols-2 gap-3">
            <FormControl v-model="batchStart" type="number" label="Start year" placeholder="2024" required />
            <FormControl v-model="batchEnd" type="number" label="End year" placeholder="2028" required />
          </div>
          <FormControl v-model="batchPrefix" label="Reg-no prefix (optional)" placeholder="RA2211003" :description="`This batch will be named ${batchName}.`" />
          <Button variant="solid" type="submit" :loading="busy" :disabled="!orgUnits.length || !batchUnit">Add batch</Button>
        </form>

        <p v-if="!batches.length" class="text-p-sm text-ink-gray-5">No batches yet. Add intakes like "2023-2027" per org unit. A reg-no prefix lets self-registration validate the number against the batch.</p>
        <table v-else class="w-full text-left text-p-sm">
          <thead class="border-b text-ink-gray-5"><tr><th class="py-2 font-normal">Batch</th><th class="font-normal">Org unit</th><th class="font-normal">Reg-no prefix</th><th /></tr></thead>
          <tbody class="divide-y divide-outline-gray-1">
            <tr v-for="b in batches" :key="b.id">
              <td class="py-2">
                <div v-if="editBatch === b.id" class="flex gap-1">
                  <FormControl v-model="editBatchStart" type="number" class="w-20" /><FormControl v-model="editBatchEnd" type="number" class="w-20" />
                </div>
                <span v-else class="text-base-medium">{{ b.name }}</span>
              </td>
              <td>{{ orgUnits.find((d) => d.id === b.org_unit_id)?.name ?? '—' }}</td>
              <td>
                <FormControl v-if="editBatch === b.id" v-model="editBatchPrefix" placeholder="any number accepted" />
                <span v-else-if="b.reg_no_prefix" class="font-mono">{{ b.reg_no_prefix }}</span>
                <span v-else class="text-ink-gray-5">Any</span>
              </td>
              <td class="text-right">
                <template v-if="editBatch === b.id">
                  <Button size="sm" variant="solid" :disabled="busy" @click="saveBatch(b.id)">Save</Button>
                  <Button size="sm" class="ml-1" @click="editBatch = null">Cancel</Button>
                </template>
                <template v-else>
                  <Button variant="ghost" aria-label="Edit" @click="editBatch = b.id; editBatchPrefix = b.reg_no_prefix ?? ''; editBatchStart = String(b.start_year); editBatchEnd = String(b.end_year)"><span class="lucide-pencil size-4" aria-hidden="true" /></Button>
                  <Button variant="ghost" aria-label="Delete" @click="askDelete('batches', b.id, b.name)"><span class="lucide-trash-2 size-4" aria-hidden="true" /></Button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>

  <ConfirmDestructive
    v-if="pending" v-model:open="showDelete" title="Delete record" :record-name="pending.name"
    :description="`Removing &quot;${pending.name}&quot;.`"
    :on-confirmed="async () => { await adminDelete(pending!.table, pending!.id); await reload(); }"
  />
</template>
