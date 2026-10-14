<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Button, FormControl, ErrorMessage, Alert } from 'frappe-ui';
import AuthShell from '../components/AuthShell.vue';
import MfaEnroll from '../components/MfaEnroll.vue';
import { supabase } from '../lib/supabase';
import { bootstrap } from '../lib/session';
import { sessionMfa } from '../lib/auth';
import {
  selfRegisterStudent, listPublicOrgUnits, listPublicBatches, type PublicOption,
} from '../lib/onboarding';

// Public student self-registration (0004). Creates a base-level account only;
// staff accounts are invite-only (AcceptInvitePage).
const router = useRouter();
const step = ref<'form' | 'confirm' | 'mfa'>('form');
const error = ref('');
const submitting = ref(false);

const fullName = ref('');
const email = ref('');
const password = ref('');
const regNo = ref('');
const orgUnits = ref<PublicOption[]>([]);
const orgUnitId = ref('');
const batches = ref<PublicOption[]>([]);
const batchId = ref('');
const catalogError = ref('');
const confirmCode = ref('');

listPublicOrgUnits()
  .then((d) => {
    orgUnits.value = d;
    if (!d.length) catalogError.value = 'No programmes have been set up yet. Ask your administrator to add them before registering.';
  })
  .catch((e) => { catalogError.value = e instanceof Error ? e.message : 'Could not load programmes.'; });

watch(orgUnitId, (id) => {
  batches.value = []; batchId.value = '';
  if (id) listPublicBatches(id).then((b) => { batches.value = b; }).catch(() => { batches.value = []; });
});

const unitOptions = computed(() => orgUnits.value.map((o) => ({ label: o.name, value: o.id })));
const batchOptions = computed(() => batches.value.map((o) => ({ label: o.name, value: o.id })));

async function run(fn: () => Promise<void>) {
  error.value = ''; submitting.value = true;
  try { await fn(); }
  catch (e) { error.value = e instanceof Error ? e.message : 'Something went wrong.'; }
  finally { submitting.value = false; }
}

async function submit() {
  if (password.value.length < 8) { error.value = 'Password must be at least 8 characters.'; return; }
  if (!orgUnitId.value || !regNo.value.trim()) { error.value = 'Programme and registration number are required.'; return; }
  await run(async () => {
    await selfRegisterStudent({
      fullName: fullName.value, email: email.value, password: password.value,
      orgUnitId: orgUnitId.value, batchId: batchId.value || null, regNo: regNo.value,
    });
    const { data: { session } } = await supabase.auth.getSession();
    step.value = session ? 'mfa' : 'confirm';
  });
}

const verifyConfirm = () => run(async () => {
  const { error: err } = await supabase.auth.verifyOtp({ email: email.value, token: confirmCode.value, type: 'signup' });
  if (err) throw err;
  step.value = 'mfa';
});

// Arriving from the emailed link lands here already holding a session; pick
// up at MFA enrolment instead of showing the form again.
let unsub: (() => void) | undefined;
onMounted(async () => {
  const mfa = await sessionMfa();
  // Someone who already has an authenticator belongs in the app (its gate asks
  // for a code if one is due); enrolling a second factor here would be wrong.
  if (mfa.signedIn && mfa.factorId) { await done(); return; }
  if (mfa.signedIn) step.value = 'mfa';
  const { data } = supabase.auth.onAuthStateChange((event, s) => {
    if (event === 'SIGNED_IN' && s?.user && step.value === 'form') step.value = 'mfa';
  });
  unsub = () => data.subscription.unsubscribe();
});
onUnmounted(() => unsub?.());

async function done() {
  await bootstrap();
  router.push('/dashboard');
}

const title = computed(() => step.value === 'form' ? 'Create your account' : step.value === 'confirm' ? 'Check your email' : 'Set up two-step sign-in');
const subtitle = computed(() => step.value === 'form' ? 'Students only — staff accounts come by invitation.'
  : step.value === 'confirm' ? `Enter the 6-digit code sent to ${email.value}.` : 'Mandatory, cannot be skipped.');
</script>

<template>
  <AuthShell :title="title" :subtitle="subtitle">
    <ErrorMessage :message="error" />
    <Alert v-if="step === 'form' && catalogError" theme="amber" :title="catalogError" />

    <form v-if="step === 'form'" class="space-y-4" @submit.prevent="submit">
      <FormControl v-model="fullName" label="Full name" required />
      <FormControl v-model="email" type="email" label="Email" autocomplete="email" required />
      <FormControl v-model="password" type="password" label="Password" autocomplete="new-password" required />
      <FormControl v-model="orgUnitId" type="select" label="Programme" :options="unitOptions" />
      <FormControl v-model="batchId" type="select" label="Batch" :options="batchOptions" :disabled="!orgUnitId" />
      <FormControl v-model="regNo" label="Registration number" required />
      <Button variant="solid" type="submit" class="w-full" :loading="submitting">Register</Button>
    </form>

    <form v-else-if="step === 'confirm'" class="space-y-4" @submit.prevent="verifyConfirm">
      <FormControl v-model="confirmCode" label="6-digit code" inputmode="numeric" maxlength="6" required />
      <Button variant="solid" type="submit" class="w-full" :loading="submitting">Verify</Button>
    </form>

    <MfaEnroll v-else @verified="done" />

    <template v-if="step === 'form'" #footer>
      Already have an account? <router-link to="/" class="text-ink-blue-link underline">Sign in</router-link>
    </template>
  </AuthShell>
</template>
