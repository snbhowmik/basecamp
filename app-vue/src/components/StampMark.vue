<script setup lang="ts">
// Die-cut postage-stamp frame for an approval: ink on paper, one colour. The
// scalloped edge is small circles in the surrounding background colour (not a
// CSS mask), so `punch` must match whatever the stamp sits on.
withDefaults(defineProps<{
  role: string; name: string; date: string; caption?: string; rotate?: number; punch?: string;
}>(), { caption: 'APPROVED', rotate: -3, punch: 'var(--surface-base)' });
</script>

<template>
  <div class="stamp" :style="{ '--punch': punch, transform: `rotate(${rotate}deg)` }">
    <span class="stamp-edge stamp-edge--h top" aria-hidden="true" />
    <span class="stamp-edge stamp-edge--h bottom" aria-hidden="true" />
    <span class="stamp-edge stamp-edge--v left" aria-hidden="true" />
    <span class="stamp-edge stamp-edge--v right" aria-hidden="true" />
    <div class="flex items-baseline justify-between gap-3 text-2xs font-semibold uppercase tracking-wider">
      <span>{{ role }}</span><span>{{ date }}</span>
    </div>
    <div class="my-1 border-y border-dashed border-current py-1 text-center text-lg-semibold">{{ name }}</div>
    <div class="text-center text-2xs font-semibold tracking-widest">{{ caption }}</div>
  </div>
</template>

<style scoped>
.stamp { position: relative; display: inline-block; min-width: 9rem; padding: 0.6rem 0.8rem; color: #2563eb; border: 2px dashed currentColor; }
.stamp-edge { position: absolute; }
.stamp-edge--h { left: 0; right: 0; height: 7px; background-image: radial-gradient(circle, var(--punch) 3.5px, transparent 4px); background-size: 14px 7px; background-color: transparent; background-repeat: repeat-x; }
.stamp-edge--h.top { top: -7px; } .stamp-edge--h.bottom { bottom: -7px; }
.stamp-edge--v { top: 0; bottom: 0; width: 7px; background-image: radial-gradient(circle, var(--punch) 3.5px, transparent 4px); background-size: 7px 14px; background-color: transparent; background-repeat: repeat-y; }
.stamp-edge--v.left { left: -7px; } .stamp-edge--v.right { right: -7px; }
</style>
