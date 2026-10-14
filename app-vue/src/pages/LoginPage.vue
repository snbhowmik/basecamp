<script setup lang="ts">
import { ref } from 'vue';
import { Button, FormControl, ErrorMessage } from 'frappe-ui';
import { signIn } from '../lib/auth';
import { bootstrap } from '../lib/session';

const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await signIn(email.value, password.value);
    await bootstrap();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not sign in.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-base p-5">
    <form class="w-full max-w-sm space-y-4" @submit.prevent="submit">
      <div>
        <h1 class="text-2xl text-ink-gray-9">Welcome back</h1>
        <p class="text-p-base text-ink-gray-5">Sign in to continue.</p>
      </div>
      <FormControl v-model="email" label="Email" type="email" autocomplete="email" required />
      <FormControl v-model="password" label="Password" type="password" autocomplete="current-password" required />
      <ErrorMessage :message="error" />
      <Button variant="solid" type="submit" class="w-full" :loading="loading">Sign in</Button>
    </form>
  </div>
</template>
