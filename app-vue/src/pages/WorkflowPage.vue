<script setup lang="ts">
import { ref } from 'vue';
import { TabButtons } from 'frappe-ui';
import AppHeader from '../components/AppHeader.vue';
import OrgSection from '../components/OrgSection.vue';
import CatalogSection from '../components/CatalogSection.vue';

// The captain's configuration surface: the org's shape (org units, batches) and
// its request taxonomy (types, categories, routing, stages). All of it is data —
// nothing here needs a deploy to change.
const section = ref<'org' | 'catalog'>('org');
</script>

<template>
  <AppHeader title="Workflow" />
  <div class="space-y-5 px-3 pb-10 pt-5 sm:px-5">
    <p class="text-p-sm text-ink-gray-5">Org units, batches, and the request categories people can file against — all configurable, none of it hardcoded.</p>
    <TabButtons v-model="section" :options="[{ label: 'Org units & batches', value: 'org' }, { label: 'Request catalog', value: 'catalog' }]" />
    <OrgSection v-if="section === 'org'" />
    <CatalogSection v-else />
  </div>
</template>
