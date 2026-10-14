import { onBeforeUnmount, onMounted, ref } from 'vue';

// Whether a CSS media query currently matches, kept live.
export function useMediaQuery(query: string) {
  const mql = typeof window === 'undefined' ? null : window.matchMedia(query);
  const matches = ref(mql?.matches ?? false);
  const on = (e: MediaQueryListEvent) => { matches.value = e.matches; };
  onMounted(() => { if (mql) { matches.value = mql.matches; mql.addEventListener('change', on); } });
  onBeforeUnmount(() => mql?.removeEventListener('change', on));
  return matches;
}

// The app's "character shift" breakpoint: where density and controls change for a
// thumb rather than a cursor. Slide-to-approve is for these screens only.
export const SMALL_SCREEN_QUERY = '(max-width: 48rem)';
