<script setup lang="ts">
import { ref, watch } from 'vue';
import { Dialog, ErrorMessage } from 'frappe-ui';
import { getMemberCard, getStickyNote, type MemberCard, type StickyNoteEntry } from '../lib/account';
import { errorMessage } from '../lib/requests';

// Tier 1 of PRD-V2 §9.1, widened to the whole portal (0023): anyone signed in
// and MFA-verified may open anyone's card. CGPA and proof (Tier 2) are not
// reachable from here. Both reads are SECURITY DEFINER RPCs that re-check the
// caller; nothing on this screen is a permission decision.
const props = defineProps<{ userId: string; name: string }>();
const open = defineModel<boolean>('open', { required: true });

const card = ref<MemberCard | null>(null);
const note = ref<StickyNoteEntry[]>([]);
const error = ref('');
const busy = ref(true);

watch(() => props.userId, (id) => {
  busy.value = true; error.value = ''; card.value = null; note.value = [];
  Promise.all([getMemberCard(id), getStickyNote(id)])
    .then(([c, n]) => { card.value = c; note.value = n; })
    .catch((e) => { error.value = errorMessage(e, 'Could not load this person.'); })
    .finally(() => { busy.value = false; });
}, { immediate: true });
</script>

<template>
  <Dialog v-model:open="open" :title="card?.full_name ?? name" size="md">
    <div class="space-y-4">
      <ErrorMessage :message="error" />
      <p v-if="busy" class="text-p-sm text-ink-gray-5">Loading…</p>
      <p v-else-if="!error && !card" class="text-p-sm text-ink-gray-5">This account is no longer active.</p>

      <template v-if="card">
        <dl class="grid grid-cols-[8rem_1fr] gap-y-2 text-p-sm">
          <dt class="text-ink-gray-5">Email</dt><dd class="break-all">{{ card.email }}</dd>
          <template v-if="card.reg_no"><dt class="text-ink-gray-5">Register number</dt><dd class="font-mono">{{ card.reg_no }}</dd></template>
          <template v-if="card.fet_id"><dt class="text-ink-gray-5">FET ID</dt><dd class="font-mono">{{ card.fet_id }}</dd></template>
          <template v-if="card.level_name"><dt class="text-ink-gray-5">Role</dt><dd>{{ card.level_name }}</dd></template>
          <dt class="text-ink-gray-5">Department</dt><dd>{{ card.org_unit_name ?? 'Not set' }}</dd>
          <template v-if="card.batch_name || card.section_name">
            <dt class="text-ink-gray-5">Batch and class</dt><dd>{{ [card.batch_name, card.section_name].filter(Boolean).join(' · ') }}</dd>
          </template>
        </dl>

        <div v-if="note.length" class="space-y-1">
          <div class="text-sm text-ink-gray-5">Attached to</div>
          <ul class="divide-y divide-outline-gray-1 text-p-sm">
            <li v-for="n in note" :key="n.level_id + n.user_id" class="flex flex-wrap justify-between gap-2 py-1.5">
              <span class="text-base-medium">{{ n.level_name }}</span>
              <span>{{ n.full_name }}</span>
              <span class="text-ink-gray-5">{{ n.section_name ?? n.org_unit_name ?? 'organisation-wide' }}</span>
            </li>
          </ul>
        </div>

        <p v-if="card.tech_count > 0 || card.non_tech_count > 0" class="text-p-sm text-ink-gray-5">
          {{ card.tech_count }} tech · {{ card.non_tech_count }} non-tech
        </p>
      </template>
    </div>
  </Dialog>
</template>
