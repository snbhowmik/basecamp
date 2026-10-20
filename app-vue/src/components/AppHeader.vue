<script setup lang="ts">
import { PageHeader, PageHeaderTitle, PageHeaderMobile } from 'frappe-ui';
import { useMediaQuery, SMALL_SCREEN_QUERY } from '../lib/useMediaQuery';

// One header for every page. frappe-ui has two: `PageHeader` (desktop; the whole row,
// actions included, goes in its default slot) and `PageHeaderMobile` (a centred title
// with #prefix / #suffix). Which one a page gets depends on the shell, so pages say
// "title + actions" and this picks the right one.
defineProps<{ title: string }>();
const small = useMediaQuery(SMALL_SCREEN_QUERY);
</script>

<template>
  <PageHeaderMobile v-if="small" :title="title">
    <template v-if="$slots.actions" #suffix><div class="pr-3"><slot name="actions" /></div></template>
  </PageHeaderMobile>
  <PageHeader v-else>
    <PageHeaderTitle :title="title" />
    <div v-if="$slots.actions" class="ml-auto"><slot name="actions" /></div>
  </PageHeader>
</template>
