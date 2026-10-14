<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Dialog, FormControl, ErrorMessage, Alert } from 'frappe-ui';
import { reverifyTotp } from '../lib/admin';
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
const code = ref('');
const error = ref('');
const nameMatches = computed(() => typed.value.trim() === props.recordName.trim());

watch(open, (o) => { if (o) { typed.value = ''; code.value = ''; error.value = ''; } });

async function submit({ close }: { close: () => void }) {
  if (!nameMatches.value || code.value.length < 6) return;
  error.value = '';
  try {
    await reverifyTotp(code.value);
    await props.onConfirmed();
    close();
  } catch (e) {
    error.value = errorMessage(e, 'Could not complete the deletion.');
    code.value = '';
  }
}
</script>

<template>
  <Dialog
    v-model:open="open" :title="title" size="md" theme="red" icon="lucide-triangle-alert"
    :actions="[{ label: 'Delete permanently', variant: 'solid', theme: 'red', disabled: !nameMatches || code.length < 6, onClick: submit }]"
  >
    <div class="space-y-4">
      <Alert theme="amber" :title="`${description ?? 'This cannot be undone.'} If anything still references this record the database will refuse the deletion and tell you what is using it.`" />
      <FormControl v-model="typed" :label="`Type “${recordName}” to confirm`" />
      <FormControl
        v-model="code" label="Authenticator code" inputmode="numeric" maxlength="6" placeholder="000000"
        :disabled="!nameMatches" description="Required for every deletion, not once per session."
      />
      <ErrorMessage :message="error" />
    </div>
  </Dialog>
</template>
