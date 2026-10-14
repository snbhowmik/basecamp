<script setup lang="ts">
import { useRoute } from 'vue-router';
import { PageHeader, PageHeaderTitle } from 'frappe-ui';
const route = useRoute();
</script>

<template>
  <PageHeader><PageHeaderTitle :title="String(route.meta.label)" /></PageHeader>
  <div class="p-5 text-p-base text-ink-gray-5">
    Not ported yet — this page still lives in the React app.
  </div>
</template>
