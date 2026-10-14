<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ErrorMessage } from 'frappe-ui';
import OneTimeCode from './OneTimeCode.vue';
import { enrollTotp, verifyTotp } from '../lib/onboarding';

// Enrols a new authenticator and verifies the first code. Mandatory and not
// skippable (PRD §7). Emits `verified` once the factor is confirmed.
const emit = defineEmits<{ verified: [] }>();

const factorId = ref<string | null>(null);
const qr = ref('');
const secret = ref('');
const error = ref('');

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

// A wrong code throws, so the row shakes; a right one fuses into "Verified" and then we finish.
async function check(c: string) {
  error.value = '';
  try { await verifyTotp(factorId.value!, c); }
  catch (err) { error.value = err instanceof Error ? err.message : 'Verification failed.'; throw err; }
}
</script>

<template>
  <div class="space-y-4">
    <ErrorMessage :message="error" />
    <div v-if="qr" class="flex justify-center">
      <img :src="qr" alt="Scan with your authenticator app" width="180" height="180" class="rounded-6 border bg-white p-3" />
    </div>
    <div v-if="secret" class="space-y-1">
      <div class="text-sm text-ink-gray-5">Can't scan? Enter this key manually</div>
      <code class="block break-all rounded-4 border bg-surface-gray-1 p-3 text-p-sm">{{ secret }}</code>
    </div>
    <div v-if="factorId" class="space-y-1">
      <div class="text-sm text-ink-gray-5">Enter the 6-digit code from the app</div>
      <div class="flex justify-center py-1"><OneTimeCode :length="6" :on-submit="check" :on-verified="() => emit('verified')" /></div>
    </div>
  </div>
</template>
