<script setup lang="ts">
import { ref } from 'vue';
import { Button, FormControl, ErrorMessage } from 'frappe-ui';
import { supabase } from '../lib/supabase';
import { session, bootstrap } from '../lib/session';
import { signOut } from '../lib/auth';
import MfaEnroll from '../components/MfaEnroll.vue';

const code = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  if (!session.factorId) return;
  error.value = '';
  loading.value = true;
  try {
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: session.factorId });
    if (chErr) throw chErr;
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId: session.factorId, challengeId: ch.id, code: code.value });
    if (vErr) throw vErr;
    await bootstrap();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'That code was not accepted.';
  } finally {
    loading.value = false;
  }
}

async function out() {
  await signOut();
  session.gate = 'login';
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-base p-5">
    <form class="w-full max-w-sm space-y-4" @submit.prevent="submit">
      <div>
        <h1 class="text-2xl text-ink-gray-9">{{ session.factorId ? 'Two-step check' : 'Set up two-step sign-in' }}</h1>
        <p class="text-p-base text-ink-gray-5">{{ session.factorId ? 'Enter the 6-digit code from your authenticator app.' : 'This account has no authenticator yet. Scan the code to finish setting one up.' }}</p>
      </div>
      <MfaEnroll v-if="!session.factorId" @verified="bootstrap" />
      <template v-else>
        <FormControl v-model="code" label="6-digit code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required />
        <ErrorMessage :message="error" />
        <Button variant="solid" type="submit" class="w-full" :loading="loading">Verify</Button>
      </template>
      <Button variant="ghost" class="w-full" @click="out">Sign out</Button>
    </form>
  </div>
</template>
