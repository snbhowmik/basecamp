<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Button, FormControl, ErrorMessage } from 'frappe-ui';
import { enrollTotp, verifyTotp } from '../lib/onboarding';

// Enrols a new authenticator and verifies the first code. Mandatory and not
// skippable (PRD §7). Emits `verified` once the factor is confirmed.
const emit = defineEmits<{ verified: [] }>();

const factorId = ref<string | null>(null);
const qr = ref('');
const secret = ref('');
const code = ref('');
const error = ref('');
const loading = ref(false);

onMounted(async () => {
  try {
    const e = await enrollTotp();
    factorId.value = e.id;
    qr.value = e.totp.qr_code;
    secret.value = e.totp.secret;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not start enrolment.';
  }
});

async function submit() {
  if (!factorId.value) return;
  error.value = '';
  loading.value = true;
  try {
    await verifyTotp(factorId.value, code.value);
    emit('verified');
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Verification failed.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <ErrorMessage :message="error" />
    <div v-if="qr" class="flex justify-center">
      <img :src="qr" alt="Scan with your authenticator app" width="180" height="180" class="rounded-6 border bg-white p-3" />
    </div>
    <div v-if="secret" class="space-y-1">
      <div class="text-sm text-ink-gray-5">Can't scan? Enter this key manually</div>
      <code class="block break-all rounded-4 border bg-surface-gray-1 p-3 text-p-sm">{{ secret }}</code>
    </div>
    <FormControl v-model="code" label="6-digit code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required />
    <Button variant="solid" type="submit" class="w-full" :loading="loading" :disabled="!factorId">Verify &amp; finish</Button>
  </form>
</template>
