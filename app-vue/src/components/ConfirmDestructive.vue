<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Dialog, FormControl, ErrorMessage, Alert } from 'frappe-ui';
import { reverifyTotp } from '../lib/admin';
import OneTimeCode from './OneTimeCode.vue';
import { errorMessage } from '../lib/requests';

// Two deliberate acts before anything is destroyed: type the record's name,
// then a fresh authenticator code. The name defends against the wrong row; the
// code defends against an unattended session and is enforced by the database
// (reverifyTotp mints a token with a fresh totp timestamp; admin_delete()
// refuses without one). Same behaviour as the React ConfirmDestructive.
const props = defineProps<{
  title: string; recordName: string; description?: string; onConfirmed: () => Promise<void>;
}>();
const open = defineModel<boolean>('open', { required: true });

const typed = ref('');
// The code is checked as soon as the row is full (the database's recently-verified-TOTP
// timestamp is what admin_delete reads); the button only enables once it was accepted.
const codeOk = ref(false);
// Bumped to remount the code row, since a verified row stays fused until it is pressed.
const codeKey = ref(0);
const error = ref('');
const nameMatches = computed(() => typed.value.trim() === props.recordName.trim());

watch(open, (o) => { if (o) { typed.value = ''; codeOk.value = false; codeKey.value++; error.value = ''; } });

async function checkCode(c: string) {
  error.value = '';
  try { await reverifyTotp(c); }
  catch (e) { error.value = errorMessage(e, 'That code was not accepted.'); throw e; }
}

async function submit({ close }: { close: () => void }) {
  if (!nameMatches.value || !codeOk.value) return;
  error.value = '';
  try {
    await props.onConfirmed();
    close();
  } catch (e) {
    error.value = errorMessage(e, 'Could not complete the deletion.');
  }
}
</script>

<template>
  <Dialog
    v-model:open="open" :title="title" size="md" theme="red" icon="lucide-triangle-alert"
    :actions="[{ label: 'Delete permanently', variant: 'solid', theme: 'red', disabled: !nameMatches || !codeOk, onClick: submit }]"
  >
    <div class="space-y-4">
      <Alert theme="amber" :title="`${description ?? 'This cannot be undone.'} If anything still references this record the database will refuse the deletion and tell you what is using it.`" />
      <FormControl v-model="typed" :label="`Type “${recordName}” to confirm`" />
      <div class="space-y-1" :class="nameMatches ? '' : 'pointer-events-none opacity-50'">
        <div class="text-sm text-ink-gray-5">Authenticator code</div>
        <div class="flex justify-center py-1"><OneTimeCode :key="codeKey" :length="6" :on-submit="checkCode" :on-verified="() => { codeOk = true; }" /></div>
        <p class="text-p-sm text-ink-gray-5">Required for every deletion, not once per session.</p>
      </div>
      <ErrorMessage :message="error" />
    </div>
  </Dialog>
</template>
