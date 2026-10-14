<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { FormControl, Button, ErrorMessage, Badge } from 'frappe-ui';
import ConfirmDestructive from './ConfirmDestructive.vue';
import RoutingEditor from './RoutingEditor.vue';
import StagesEditor from './StagesEditor.vue';
import FieldsEditor from './FieldsEditor.vue';
import {
  listRequestTypes, createRequestType, listCategories, createCategory, setCategoryActive,
  renameRequestType, renameCategory, setCategoryKind,
} from '../lib/org';
import { listTags, listPriorityLevels } from '../lib/invites';
import { adminDelete, type DeletableTable } from '../lib/admin';
import type { RequestType, RequestCategory, Tag, PriorityLevel } from '../lib/types';
import { errorMessage } from '../lib/requests';

const types = ref<RequestType[]>([]);
const categories = ref<RequestCategory[]>([]);
const tags = ref<Tag[]>([]);
const levels = ref<PriorityLevel[]>([]);
const loading = ref(true);
const error = ref('');
const busy = ref(false);

const typeName = ref('');
const typeCode = ref('');
const typeMode = ref<'approval' | 'log_only'>('approval');
const catType = ref('');
const catParent = ref('');
const catName = ref('');
const catClass = ref<'tech' | 'non_tech' | ''>('');
const catScope = ref<'internal' | 'external' | ''>('');
const editScope = ref<'internal' | 'external' | ''>('');
const editClass = ref<'tech' | 'non_tech' | ''>('');
const fieldsFor = ref<RequestCategory | null>(null);
const showFields = ref(false);
const catRetain = ref('purge');

const editType = ref<string | null>(null);
const editTypeName = ref('');
const editCat = ref<string | null>(null);
const editCatName = ref('');
const routingFor = ref<RequestCategory | null>(null);
const showRouting = ref(false);
const stagesFor = ref<RequestCategory | null>(null);
const showStages = ref(false);
const pending = ref<{ table: DeletableTable; id: string; name: string } | null>(null);
const showDelete = ref(false);

async function reload() {
  try {
    const [t, c, tg, lv] = await Promise.all([listRequestTypes(), listCategories(), listTags(), listPriorityLevels()]);
    types.value = t; categories.value = c; tags.value = tg; levels.value = lv;
  } catch (e) { error.value = errorMessage(e, 'Failed to load.'); }
  finally { loading.value = false; }
}
onMounted(reload);

async function run(fn: () => Promise<void>, fallback: string) {
  busy.value = true; error.value = '';
  try { await fn(); await reload(); } catch (e) { error.value = errorMessage(e, fallback); } finally { busy.value = false; }
}

const addType = () => run(async () => { await createRequestType(typeCode.value, typeName.value, typeMode.value); typeCode.value = ''; typeName.value = ''; }, 'Could not create request type.');
const addCategory = () => run(async () => {
  await createCategory({
    requestTypeId: catType.value, parentId: catParent.value || null, name: catName.value,
    classification: catClass.value || null, scope: catScope.value || null, retainAttachments: catRetain.value === 'keep',
  });
  catName.value = '';
}, 'Could not create category.');
const toggleActive = (c: RequestCategory) => run(() => setCategoryActive(c.id, !c.is_active), 'Could not update category.');
const saveType = (id: string) => run(async () => { await renameRequestType(id, editTypeName.value); editType.value = null; }, 'Could not rename the request type.');
const saveCat = (id: string) => run(async () => {
  await renameCategory(id, editCatName.value);
  await setCategoryKind(id, editScope.value || null, editClass.value || null);
  editCat.value = null;
}, 'Could not save the category.');
const startEdit = (c: RequestCategory) => { editCat.value = c.id; editCatName.value = c.name; editScope.value = c.scope ?? ''; editClass.value = c.classification ?? ''; };
function askDelete(table: DeletableTable, id: string, name: string) { pending.value = { table, id, name }; showDelete.value = true; }

const typeOptions = computed(() => types.value.map((t) => ({ label: t.name, value: t.id })));
const parentOptions = computed(() => [{ label: 'Top level', value: '' },
  ...categories.value.filter((c) => !catType.value || c.request_type_id === catType.value).map((c) => ({ label: c.name, value: c.id }))]);
const modeOptions = [{ label: 'Approval — needs a real decision', value: 'approval' }, { label: 'Log only — reviewed and saved', value: 'log_only' }];
const classOptions = [{ label: 'Unclassified', value: '' }, { label: 'Tech', value: 'tech' }, { label: 'Non-tech', value: 'non_tech' }];
const scopeOptions = [{ label: 'Not set', value: '' }, { label: 'Internal event', value: 'internal' }, { label: 'External event', value: 'external' }];
const retainOptions = [{ label: 'Purge after a grace period', value: 'purge' }, { label: 'Keep permanently (certificates)', value: 'keep' }];
</script>

<template>
  <p v-if="loading" class="py-12 text-center text-p-sm text-ink-gray-5">Loading…</p>
  <div v-else class="space-y-10">
    <ErrorMessage :message="error" />

    <section class="space-y-4">
      <h2 class="text-lg-semibold">Request types</h2>
      <form class="grid grid-cols-3 items-end gap-3" @submit.prevent="addType">
        <FormControl v-model="typeName" label="Name" placeholder="On-Duty Request" required />
        <FormControl v-model="typeCode" label="Code" placeholder="od_request" required />
        <FormControl v-model="typeMode" type="select" label="Decision mode" :options="modeOptions" />
        <Button variant="solid" type="submit" :loading="busy" class="col-span-3">Add request type</Button>
      </form>
      <p v-if="!types.length" class="text-p-sm text-ink-gray-5">None yet.</p>
      <table v-else class="w-full text-left text-p-sm">
        <thead class="border-b text-ink-gray-5"><tr><th class="py-2 font-normal">Type</th><th class="font-normal">Code</th><th class="font-normal">Mode</th><th /></tr></thead>
        <tbody class="divide-y divide-outline-gray-1">
          <tr v-for="t in types" :key="t.id">
            <td class="py-2"><FormControl v-if="editType === t.id" v-model="editTypeName" /><span v-else class="text-base-medium">{{ t.name }}</span></td>
            <td class="font-mono">{{ t.code }}</td>
            <td><Badge :label="t.decision_mode === 'approval' ? 'Approval' : 'Log only'" /></td>
            <td class="text-right">
              <template v-if="editType === t.id">
                <Button size="sm" variant="solid" :disabled="busy" @click="saveType(t.id)">Save</Button>
                <Button size="sm" class="ml-1" @click="editType = null">Cancel</Button>
              </template>
              <template v-else>
                <Button variant="ghost" aria-label="Rename" @click="editType = t.id; editTypeName = t.name"><span class="lucide-pencil size-4" aria-hidden="true" /></Button>
                <Button variant="ghost" aria-label="Delete" @click="askDelete('request_types', t.id, t.name)"><span class="lucide-trash-2 size-4" aria-hidden="true" /></Button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="space-y-4">
      <h2 class="text-lg-semibold">Categories</h2>
      <form class="grid grid-cols-2 gap-3" @submit.prevent="addCategory">
        <FormControl v-model="catType" type="select" label="Request type" :options="typeOptions" @update:model-value="catParent = ''" />
        <FormControl v-model="catParent" type="select" label="Parent category (optional)" :options="parentOptions" :disabled="!catType" />
        <FormControl v-model="catName" label="Name" placeholder="Hackathon" required />
        <FormControl v-model="catScope" type="select" label="Event kind" :options="scopeOptions" />
        <FormControl v-model="catClass" type="select" label="Tech / non-tech" :options="classOptions" description="Decides the route for internal events — set up under Routing and Stages." />
        <div class="col-span-2">
          <FormControl
            v-model="catRetain" type="select" label="Attachments after close" :options="retainOptions"
            description="Nothing closes a request yet, so this has never taken effect and the purge job is still unbuilt. Material collected after the event belongs to a follow-up stage, under Stages."
          />
        </div>
        <div class="col-span-2 flex items-center gap-3">
          <Button variant="solid" type="submit" :loading="busy" :disabled="!types.length || !catType">Add category</Button>
          <span v-if="!types.length" class="text-p-sm text-ink-gray-5">Create a request type first.</span>
        </div>
      </form>

      <p v-if="!categories.length" class="text-p-sm text-ink-gray-5">No categories yet. Categories are what people actually file requests against.</p>
      <table v-else class="w-full text-left text-p-sm">
        <thead class="border-b text-ink-gray-5"><tr><th class="py-2 font-normal">Category</th><th class="font-normal">Kind</th><th class="font-normal">Parent</th><th class="font-normal">Status</th><th /></tr></thead>
        <tbody class="divide-y divide-outline-gray-1">
          <tr v-for="c in categories" :key="c.id">
            <td class="py-2">
              <FormControl v-if="editCat === c.id" v-model="editCatName" />
              <div v-else class="text-base-medium">{{ c.name }}</div>
              <div class="font-mono text-xs text-ink-gray-5">{{ types.find((t) => t.id === c.request_type_id)?.code ?? '' }}</div>
            </td>
            <td>
              <div v-if="editCat === c.id" class="flex gap-1">
                <div class="w-36"><FormControl v-model="editScope" type="select" :options="scopeOptions" /></div>
                <div class="w-36"><FormControl v-model="editClass" type="select" :options="classOptions" /></div>
              </div>
              <div v-else class="flex flex-wrap gap-1">
                <Badge v-if="c.scope" :theme="c.scope === 'external' ? 'violet' : 'blue'" :label="c.scope === 'external' ? 'External' : 'Internal'" />
                <Badge v-if="c.classification" :label="c.classification === 'tech' ? 'Tech' : 'Non-tech'" />
                <span v-if="!c.scope && !c.classification" class="text-ink-gray-5">Not set</span>
              </div>
            </td>
            <td>{{ categories.find((p) => p.id === c.parent_id)?.name ?? '—' }}</td>
            <td><Badge :theme="c.is_active ? 'green' : 'gray'" :label="c.is_active ? 'Active' : 'Hidden'" /></td>
            <td class="whitespace-nowrap text-right">
              <template v-if="editCat === c.id">
                <Button size="sm" variant="solid" :disabled="busy" @click="saveCat(c.id)">Save</Button>
                <Button size="sm" class="ml-1" @click="editCat = null">Cancel</Button>
              </template>
              <template v-else>
                <Button size="sm" @click="routingFor = c; showRouting = true">Routing</Button>
                <Button size="sm" class="ml-1" @click="stagesFor = c; showStages = true">Stages</Button>
                <Button size="sm" class="ml-1" @click="fieldsFor = c; showFields = true">Fields</Button>
                <Button variant="ghost" aria-label="Edit" @click="startEdit(c)"><span class="lucide-pencil size-4" aria-hidden="true" /></Button>
                <Button variant="ghost" :aria-label="c.is_active ? 'Hide' : 'Show'" @click="toggleActive(c)"><span :class="c.is_active ? 'lucide-eye-off' : 'lucide-eye'" class="size-4" aria-hidden="true" /></Button>
                <Button variant="ghost" aria-label="Delete" @click="askDelete('request_categories', c.id, c.name)"><span class="lucide-trash-2 size-4" aria-hidden="true" /></Button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>

  <RoutingEditor v-if="routingFor" v-model:open="showRouting" :category="routingFor" :tags="tags" />
  <FieldsEditor v-if="fieldsFor" v-model:open="showFields" :category="fieldsFor" />
  <StagesEditor v-if="stagesFor" v-model:open="showStages" :category="stagesFor" :levels="levels" :tags="tags" />
  <ConfirmDestructive
    v-if="pending" v-model:open="showDelete" title="Delete record" :record-name="pending.name"
    :description="`Removing &quot;${pending.name}&quot;.`"
    :on-confirmed="async () => { await adminDelete(pending!.table, pending!.id); await reload(); }"
  />
</template>
