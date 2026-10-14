<script setup lang="ts">
import { ref } from 'vue';
import { Button, ErrorMessage } from 'frappe-ui';
import OneTimeCode from '../components/OneTimeCode.vue';
import { supabase } from '../lib/supabase';
import { session, bootstrap } from '../lib/session';
import { signOut } from '../lib/auth';
import MfaEnroll from '../components/MfaEnroll.vue';

const error = ref('');

// A wrong code throws, which is what makes the one-time-code row shake and drain;
// success lets it fuse into "Verified" and only then moves on to the app.
async function check(code: string) {
  if (!session.factorId) return;
  error.value = '';
  try {
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: session.factorId });
    if (chErr) throw chErr;
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId: session.factorId, challengeId: ch.id, code });
    if (vErr) throw vErr;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'That code was not accepted.';
    throw e;
  }
}

async function out() {
  await signOut();
  session.gate = 'login';
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-base p-5">
    <div class="w-full max-w-sm space-y-4">
      <div>
        <h1 class="text-2xl text-ink-gray-9">{{ session.factorId ? 'Two-step check' : 'Set up two-step sign-in' }}</h1>
        <p class="text-p-base text-ink-gray-5">{{ session.factorId ? 'Enter the 6-digit code from your authenticator app.' : 'This account has no authenticator yet. Scan the code to finish setting one up.' }}</p>
      </div>
      <MfaEnroll v-if="!session.factorId" @verified="bootstrap" />
      <template v-else>
        <div class="flex justify-center py-2"><OneTimeCode :length="6" :on-submit="check" :on-verified="bootstrap" /></div>
        <ErrorMessage :message="error" />
      </template>
      <Button variant="ghost" class="w-full" @click="out">Sign out</Button>
    </div>
  </div>
</template>
