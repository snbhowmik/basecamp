<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { FrappeUIProvider, useColorScheme } from 'frappe-ui';
import { bootstrap, session } from './lib/session';
import AppLayout from './layouts/AppLayout.vue';
import LoginPage from './pages/LoginPage.vue';
import VerifyMfaPage from './pages/VerifyMfaPage.vue';

const route = useRoute();
// Applies the stored light/dark/system preference at startup, on every page, not only the one that shows the picker.
useColorScheme();
onMounted(bootstrap);
</script>

<template>
  <FrappeUIProvider>
    <router-view v-if="route.meta.public" />
    <div v-else-if="session.gate === 'loading'" class="flex h-screen items-center justify-center bg-surface-base text-ink-gray-5 text-sm">
      Loading…
    </div>
    <LoginPage v-else-if="session.gate === 'login'" />
    <VerifyMfaPage v-else-if="session.gate === 'verify'" />
    <AppLayout v-else />
  </FrappeUIProvider>
</template>
