<script setup lang="ts">
import { PageHeader, PageHeaderTitle } from 'frappe-ui';
import { session } from '../lib/session';
</script>

<template>
  <PageHeader><PageHeaderTitle title="Dashboard" /></PageHeader>
  <div class="p-5 text-p-base">
    Signed in as <strong>{{ session.ctx?.profile.full_name }}</strong>
    <span v-if="session.ctx?.isCaptain" class="text-ink-gray-5"> (captain)</span>.
  </div>
</template>
