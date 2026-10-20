<script setup lang="ts">
import { useRoute } from 'vue-router';
import { } from 'frappe-ui';
import AppHeader from '../components/AppHeader.vue';
const route = useRoute();
</script>

<template>
  <AppHeader :title="String(route.meta.label)" />
  <div class=" px-3 pb-10 pt-5 sm:px-5 text-p-base text-ink-gray-5">
    Not ported yet — this page still lives in the React app.
  </div>
</template>
