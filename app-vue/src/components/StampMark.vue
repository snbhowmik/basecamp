<script setup lang="ts">
// A postage-stamp frame for an approval. The mechanism is dqnamo.com's "Stamp"
// experiment: a paper rectangle whose border is a row of perforations (small
// notches along all four sides), a soft sheen across the upper-left, and a
// layered drop shadow. Original implementation.
//
// The perforation is a real mask, not background-coloured dots painted over the
// edge: a transparent border band is masked by a lattice of holes, and the inside
// (padding box) is masked solid and unioned with it — so the notches are genuinely
// transparent and the stamp sits on any background, light or dark, with no
// "punch colour" to match.
withDefaults(defineProps<{
  role: string; name: string; date: string; caption?: string; rotate?: number; ink?: string;
}>(), { caption: 'APPROVED', rotate: -3, ink: '#1d4ed8' });
</script>

<template>
  <div class="stamp-wrap" :style="{ transform: `rotate(${rotate}deg)` }">
    <div class="stamp" :style="{ color: ink }">
      <div class="flex items-baseline justify-between gap-3 text-2xs font-semibold uppercase tracking-wider">
        <span>{{ role }}</span><span>{{ date }}</span>
      </div>
      <div class="my-1.5 border-y border-dashed border-current py-2 text-center text-lg-semibold">{{ name }}</div>
      <div class="text-center text-2xs font-semibold tracking-widest">{{ caption }}</div>
    </div>
  </div>
</template>

<style scoped>
.stamp-wrap { display: inline-block; filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.2)) drop-shadow(0 8px 14px rgb(0 0 0 / 0.14)); }
.stamp {
  --band: 9px;   /* width of the perforated band */
  --hole: 4.2px; /* hole radius */
  min-width: 9.5rem;
  padding: 0.7rem 0.8rem;
  border: var(--band) solid transparent;
  background: #fff;
  /* sheen */
  background-image: linear-gradient(135deg, rgb(255 255 255 / 0.9), rgb(255 255 255 / 0) 45%);
  background-color: #fbfaf7;
  -webkit-mask:
    linear-gradient(#000 0 0) padding-box,
    radial-gradient(circle at 50% 50%, #0000 var(--hole), #000 calc(var(--hole) + 0.6px)) 0 0 / 13px 13px round;
  -webkit-mask-composite: source-over;
  mask:
    linear-gradient(#000 0 0) padding-box,
    radial-gradient(circle at 50% 50%, #0000 var(--hole), #000 calc(var(--hole) + 0.6px)) 0 0 / 13px 13px round;
  mask-composite: add;
}
</style>
