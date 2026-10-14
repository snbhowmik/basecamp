<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Dialog, FormControl, Button, ErrorMessage } from 'frappe-ui';
import ConfirmDestructive from './ConfirmDestructive.vue';
import { listFirstHopOptions, createFirstHopOption, deleteFirstHopOption, type FirstHopOption } from '../lib/org';
import type { RequestCategory, Tag } from '../lib/types';
import { errorMessage } from '../lib/requests';

// Who a category's requests go to first. Each option resolves to real people by
// tag at filing time — "Your Mentor" finds the mentor for that student's own
// batch, not a fixed person.
const props = defineProps<{ category: RequestCategory; tags: Tag[] }>();
const open = defineModel<boolean>('open', { required: true });

const options = ref<FirstHopOption[]>([]);
const label = ref('');
const tagCode = ref('');
const busy = ref(false);
const error = ref('');
const pending = ref<FirstHopOption | null>(null);
const showDelete = ref(false);

const reload = () => listFirstHopOptions(props.category.id).then((o) => { options.value = o; }).catch(() => { options.value = []; });
watch(() => props.category.id, reload, { immediate: true });

const tagOptions = computed(() => props.tags.filter((t) => !t.code.startsWith('org:')).map((t) => ({ label: `${t.label} (${t.code})`, value: t.code })));

async function add() {
  busy.value = true; error.value = '';
  try { await createFirstHopOption(props.category.id, label.value, tagCode.value); label.value = ''; await reload(); }
  catch (e) { error.value = errorMessage(e, 'Could not add option.'); }
  finally { busy.value = false; }
}
</script>

<template>
  <Dialog v-model:open="open" :title="`Routing — ${category.name}`" size="2xl" :actions="[{ label: 'Done', variant: 'subtle' }]">
    <div class="space-y-4">
      <p class="text-p-sm text-ink-gray-5">Who should this category's requests go to first? Each option resolves to real people by tag when someone files a request — so "Your Mentor" finds the mentor for that student's own batch, not a fixed person.</p>
      <ErrorMessage :message="error" />
      <form class="grid grid-cols-[1fr_1fr_auto] items-end gap-3" @submit.prevent="add">
        <FormControl v-model="label" label="Label shown to the requester" placeholder="Your Mentor" required />
        <FormControl v-model="tagCode" type="select" label="Resolves to tag" :options="tagOptions" />
        <Button variant="solid" type="submit" :loading="busy" :disabled="!tagCode">Add</Button>
      </form>
      <p v-if="!options.length" class="text-p-sm text-ink-gray-5">No options configured — requests in this category will be submitted unassigned.</p>
      <ul class="divide-y divide-outline-gray-1">
        <li v-for="o in options" :key="o.id" class="flex items-center justify-between py-2 text-p-sm">
          <div><span class="text-base-medium">{{ o.label }}</span> <span class="ml-2 font-mono text-ink-gray-5">{{ o.resolve_tag }}</span></div>
          <Button variant="ghost" aria-label="Delete option" @click="pending = o; showDelete = true"><span class="lucide-trash-2 size-4" aria-hidden="true" /></Button>
        </li>
      </ul>
    </div>
  </Dialog>
  <ConfirmDestructive
    v-if="pending" v-model:open="showDelete" title="Delete routing option" :record-name="pending.label"
    :description="`Removing &quot;${pending.label}&quot;.`"
    :on-confirmed="async () => { await deleteFirstHopOption(pending!.id); await reload(); }"
  />
</template>
