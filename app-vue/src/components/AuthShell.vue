<script setup lang="ts">
// Centered card used by every pre-login screen.
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-base px-3 py-8 sm:px-5">
    <div class="w-full max-w-sm space-y-4">
      <div>
        <h1 class="text-2xl text-ink-gray-9">{{ title }}</h1>
        <p v-if="subtitle" class="text-p-base text-ink-gray-5">{{ subtitle }}</p>
      </div>
      <slot />
      <div v-if="$slots.footer" class="border-t pt-4 text-p-sm text-ink-gray-5"><slot name="footer" /></div>
    </div>
  </div>
</template>
