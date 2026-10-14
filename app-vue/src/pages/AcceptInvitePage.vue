<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Button, FormControl, ErrorMessage, Password } from 'frappe-ui';
import AuthShell from '../components/AuthShell.vue';
import MfaEnroll from '../components/MfaEnroll.vue';
import OneTimeCode from '../components/OneTimeCode.vue';
import { supabase } from '../lib/supabase';
import { bootstrap } from '../lib/session';
import { sessionMfa } from '../lib/auth';
import { getInviteByToken, acceptInvite, type InviteDetails } from '../lib/onboarding';

// Staff/faculty onboarding via /invite/<token> (0004/0005). Order matters:
// session first, invite row second — apply_pending_assignment() consumes the
// invite when the account is created, i.e. before the confirmation link is
// clicked, so on the way back the invite row is already spent. Once a session
// exists, all that is left is finishing MFA.
const route = useRoute();
const router = useRouter();
const token = String(route.params.token);

const loading = ref(true);
const invite = ref<InviteDetails | null>(null);
const lookupFailed = ref(false);
const step = ref<'form' | 'confirm' | 'mfa'>('form');
const error = ref('');
const submitting = ref(false);
const fullName = ref('');
const password = ref('');

async function finish() {
  await bootstrap();
  router.push('/dashboard');
}

onMounted(async () => {
  const mfa = await sessionMfa();
  if (mfa.signedIn) {
    if (mfa.factorId) { await finish(); return; }
    step.value = 'mfa';
    loading.value = false;
    return;
  }
  try { invite.value = await getInviteByToken(token); }
  catch { lookupFailed.value = true; } // an outage is not the same as a spent token
  loading.value = false;
});

async function run(fn: () => Promise<void>) {
  error.value = ''; submitting.value = true;
  try { await fn(); }
  catch (e) { error.value = e instanceof Error ? e.message : 'Something went wrong.'; }
  finally { submitting.value = false; }
}

const submit = () => {
  if (!invite.value) return;
  if (password.value.length < 8) { error.value = 'Password must be at least 8 characters.'; return; }
  return run(async () => {
    await acceptInvite(invite.value!.email, fullName.value, password.value, token);
    const { data: { session } } = await supabase.auth.getSession();
    step.value = session ? 'mfa' : 'confirm';
  });
};

// The emailed code: a wrong one throws, which shakes the row; a right one fuses and moves on.
async function verifyConfirm(token: string) {
  error.value = '';
  const { error: err } = await supabase.auth.verifyOtp({ email: invite.value!.email, token, type: 'signup' });
  if (err) { error.value = err.message; throw err; }
}

const title = computed(() => step.value === 'form' ? 'Complete your account' : step.value === 'confirm' ? 'Check your email' : 'Set up two-step sign-in');
const subtitle = computed(() => step.value === 'form' && invite.value
  ? `Invited as ${invite.value.levelName}${invite.value.orgUnitName ? ` in ${invite.value.orgUnitName}` : ''}${invite.value.invitedByName ? ` by ${invite.value.invitedByName}` : ''} — ${invite.value.email}`
  : step.value === 'confirm' ? `Enter the 6-digit code sent to ${invite.value?.email ?? 'your email'}.` : 'Mandatory, cannot be skipped.');
</script>

<template>
  <div v-if="loading" class="flex h-screen items-center justify-center bg-surface-base text-sm text-ink-gray-5">Loading…</div>

  <AuthShell v-else-if="!invite && step === 'form'" :title="lookupFailed ? 'Could not check this invite' : 'Invite not found'"
             :subtitle="lookupFailed
               ? 'The server could not be reached. Try again in a moment — the link itself may be fine.'
               : 'This link is invalid, already used, or has been revoked. Contact whoever invited you.'" />

  <AuthShell v-else :title="title" :subtitle="subtitle">
    <ErrorMessage :message="error" />
    <form v-if="step === 'form'" class="space-y-4" @submit.prevent="submit">
      <FormControl v-model="fullName" label="Full name" required />
      <Password v-model="password" label="Password" autocomplete="new-password" required />
      <Button variant="solid" type="submit" class="w-full" :loading="submitting">Continue</Button>
    </form>
    <div v-else-if="step === 'confirm'" class="flex justify-center py-2">
      <OneTimeCode :length="6" :on-submit="verifyConfirm" :on-verified="() => { step = 'mfa'; }" />
    </div>
    <MfaEnroll v-else @verified="finish" />
  </AuthShell>
</template>
