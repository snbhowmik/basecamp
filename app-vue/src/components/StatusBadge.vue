<script setup lang="ts">
import { computed } from 'vue';
import { Badge } from 'frappe-ui';

// Maps the request_status enum (schema-v2/0002_requests.sql) to a theme.
const MAP: Record<string, { label: string; theme: 'gray' | 'blue' | 'green' | 'amber' | 'red' }> = {
  draft: { label: 'Draft', theme: 'gray' },
  submitted: { label: 'Submitted', theme: 'blue' },
  in_review: { label: 'In review', theme: 'blue' },
  changes_requested: { label: 'Changes requested', theme: 'amber' },
  approved: { label: 'Approved', theme: 'green' },
  rejected: { label: 'Rejected', theme: 'red' },
  reviewed: { label: 'Reviewed', theme: 'green' },
  closed: { label: 'Closed', theme: 'gray' },
};

const props = defineProps<{ status: string }>();
const m = computed(() => MAP[props.status] ?? { label: props.status, theme: 'gray' as const });
</script>

<template>
  <Badge :theme="m.theme" :label="m.label" />
</template>
