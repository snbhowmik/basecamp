<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Button, FormControl, ErrorMessage, Password } from 'frappe-ui';
import Brand from '../components/Brand.vue';
import { signIn } from '../lib/auth';
import { bootstrap } from '../lib/session';

const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

// The login stays on the light palette whatever the viewer's theme, as the React
// login does. frappe's tokens switch on [data-theme=dark] on <html>, so the page
// lifts that while it is mounted and puts the viewer's choice back on the way out.
let savedTheme: string | null = null;
onMounted(() => {
  savedTheme = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', 'light');
});
onBeforeUnmount(() => {
  if (savedTheme === null) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', savedTheme);
});

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
  <div class="login grid min-h-screen grid-cols-1 bg-surface-gray-1 lg:grid-cols-2">
    <!-- Brand panel: the institution's blue, the ruled form-stock pattern, copy at the
         head and the mark at the foot, the way the letterhead signs off. Desktop only. -->
    <aside class="login-panel relative hidden flex-col overflow-hidden px-10 py-14 text-white lg:flex">
      <div class="login-pattern absolute inset-0" aria-hidden="true" />
      <div class="relative z-[1] max-w-sm">
        <h2 class="text-2xl-semibold">BaseCamp</h2>
        <p class="mt-3 leading-relaxed opacity-80">
          A request and ticketing platform. Track less. Manage better — built for your organisation.
        </p>
      </div>
      <div class="relative z-[1] mt-auto pt-8">
        <Brand variant="white" :height="58" />
      </div>
    </aside>

    <div class="grid place-items-center px-4 py-10 sm:px-6">
      <form class="w-full max-w-[26rem] space-y-5" @submit.prevent="submit">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h1 class="text-2xl text-ink-gray-9">Welcome back</h1>
            <p class="mt-1 text-p-base text-ink-gray-5">Sign in to continue.</p>
          </div>
          <!-- Below the panel breakpoint the mark moves up here, as on the React page. -->
          <div class="lg:hidden"><Brand :height="34" /></div>
        </div>

        <FormControl v-model="email" label="Email" type="email" autocomplete="email" required />
        <Password v-model="password" label="Password" autocomplete="current-password" required />
        <ErrorMessage :message="error" />
        <Button variant="solid" theme="blue" type="submit" class="w-full" :loading="loading">Sign in</Button>
        <p class="border-t pt-4 text-p-sm text-ink-gray-5">
          Student? <router-link to="/register" class="text-ink-blue-link underline underline-offset-2">Register here</router-link>
        </p>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* The React login's panel colour, deeper than frappe's blue 600 used for the button. */
.login-panel { background: #154494; }

/* Ruled form stock, as on the React login: faint horizontal lines on a 2.75rem
   pitch, fading out toward the foot of the panel. */
.login-pattern {
  background-image: repeating-linear-gradient(to bottom, rgb(255 255 255 / 3.5%) 0 1px, transparent 1px 2.75rem);
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 55%, transparent 100%);
  mask-image: linear-gradient(to bottom, #000 0%, #000 55%, transparent 100%);
}
</style>
