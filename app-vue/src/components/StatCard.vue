<script setup lang="ts">
defineProps<{ icon: string; label: string; value: number | string }>();
</script>

<template>
  <div class="flex items-center gap-3 rounded-6 border p-4">
    <span class="flex size-10 items-center justify-center rounded-5 bg-surface-gray-2 text-ink-gray-7">
      <span :class="icon" class="size-5" aria-hidden="true" />
    </span>
    <div>
      <div class="text-p-sm text-ink-gray-5">{{ label }}</div>
      <div class="text-2xl tabular-nums text-ink-gray-9">{{ value }}</div>
    </div>
  </div>
</template>
