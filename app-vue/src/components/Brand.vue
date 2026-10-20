<script setup lang="ts">
import colorLogo from '../assets/srm-logo-color.jpeg';
import whiteLogo from '../assets/srm-logo-white.png';

// The institution's mark, used as-is rather than redrawn. The colour asset ships as a
// JPEG on a white ground, so on a tinted or dark surface it needs `mix-blend-mode:
// multiply` to drop the white box (and is swapped for the white mark in dark mode via
// the `dark` prop's caller) rather than shipping a re-cut PNG that would have to be
// kept in sync with whatever the institution issues next.
withDefaults(defineProps<{ variant?: 'color' | 'white'; height?: number }>(), { variant: 'color', height: 32 });
</script>

<template>
  <img
    :src="variant === 'white' ? whiteLogo : colorLogo"
    alt="SRM Institute of Science and Technology, Tiruchirappalli"
    :style="{ height: height + 'px', width: 'auto', display: 'block', mixBlendMode: variant === 'white' ? 'normal' : 'multiply' }"
  />
</template>
