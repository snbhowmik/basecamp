<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';

/* ══ One-time code ════════════════════════════════════════
   Six small cells and a caret. Digits rise into their cells;
   a right code draws the cells together until they fuse into
   one capsule that says so, and a wrong one sends a shiver
   down the row and drains the digits out.

   Bencho's "One-time code", MIT (bencho.dev/licence), ported from
   React to Vue for this app; the comments are theirs.

   ── SIX CELLS, ONE FIELD ────────────────────────────────
   The same call the sign-in sheet makes, for the same reasons:
   six real inputs break paste, autofill from the notification,
   backspace and screen readers. So there is one invisible
   input over the row and the cells are drawn underneath it.

   ── THE MERGE IS THE GOO'S ──────────────────────────────
   The cells sit under a blur-and-threshold filter, far enough
   apart that it never bridges them. Verifying slides them to
   the middle while a capsule grows out of the same point: as
   they close, the filter joins them, and what is left is one
   shape. Nobody draws the in-between — it is the filter
   deciding when two things are close enough to be one.

   ── ADAPTED FOR BASECAMP ────────────────────────────────
   The demo's `answer` prop picked Accept/Reject synchronously,
   for the wall's own rehearsal. Here a full row calls `onSubmit`
   — the real TOTP / email-code check, which throws on a wrong code —
   and the "check" phase waits on it instead of a fixed timer, with a
   300ms floor so a network that answers instantly still reads as
   having checked rather than flashing.

   ── PORTED TO VUE ───────────────────────────────────────
   React re-rendered this every frame through a `setTick`; here a `tick`
   ref is bumped by the same loop and the template reads it, so the
   template re-evaluates exactly when the loop says something moved.
   The moving parts stay plain mutable objects, as `useRef` was. */

/* ══ liquid ═══════════════════════════════════════════════
   ── why the filter id is per-instance ───────────────────
   Duplicate SVG ids do not scope, they collide: a second instance
   silently steals the first one's filter. useId() gives each mount
   its own name.

   ── what the goo can and cannot do ──────────────────────
   This is feGaussianBlur + feColorMatrix, not a shader. The
   matrix multiplies alpha by `cut` and subtracts half of it,
   so alpha below 0.5 lands on zero and everything above 0.536
   is fully opaque. That hard edge is what fuses nearby shapes
   into one blob — and it is also why this must never touch
   text: glyph antialiasing lives entirely below 0.5, so type
   under this filter loses its edges and then itself. */
const gooId = `goo-${useId().replace(/:/g, '')}`;
const BLUR = 3;
const CUT = 24;

/* ── one spring, for everything that settles ───────────────
   `dt` is expressed in sixtieths of a second and the damping is RAISED
   to it rather than multiplied by it, so a dropped frame decays the same
   amount of energy as the two frames it replaced. Multiplying is the
   version that makes a spring behave differently on a busy page, which
   is the hardest kind of bug to see.

   The loop parks itself the moment the value has settled. */
const stillness = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* how long a cell takes to swell and settle when a digit lands */
const POP_MS = 260;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, v: number) => {
  const u = clamp((v - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};

/* a cell, and the air between two */
const W = 36;
const H = 44;
const G = 7;
/* the capsule a right code becomes */
const CAP = 128;
/* ── the merge is a SPRING, not a tween ─────────────────
   It was a 560ms ease-in-out, which arrived and stopped. A spring a
   little under critical lets the capsule run past its size and come
   back — stretching long and thin on the way out and settling round —
   which is what makes the fuse read as liquid rather than as boxes
   sliding. Per frame at 60Hz, from a stiffness and a damping ratio. */
const MERGE = (() => {
  const k = 0.075;
  const zeta = 0.42;
  return { k, d: 1 - 2 * zeta * Math.sqrt(k) };
})();
const SHAKE_MS = 620;
/* the shortest a check may read as a check, however fast the network */
const MIN_CHECK_MS = 300;

type Phase = 'type' | 'check' | 'ok' | 'no';

const props = withDefaults(defineProps<{
  /* how many digits, 4 or 6 */
  length?: number;
  /* the cells' corner, px; the capsule wears the same one */
  corner?: number;
  /* the real check — resolves to accept, throws (or resolves false) to reject */
  onSubmit: (code: string) => Promise<boolean | void>;
  /* fires once, after the capsule has settled on "ok" */
  onVerified?: () => void;
}>(), { length: 6, corner: 12 });

const n = computed(() => (props.length === 4 ? 4 : 6));
const r = computed(() => clamp(props.corner, 0, H / 2));
const rowW = computed(() => n.value * W + (n.value - 1) * G);
const still = stillness();

const code = ref('');
const phase = ref<Phase>('type');
const focus = ref(false);
const input = ref<HTMLInputElement | null>(null);
const tick = ref(0);

/* moving parts, read by the loop */
const caret = { x: W / 2, v: 0 };
/* when each cell last took a digit — for the little swell */
const popAt: number[] = [];
const merge = { m: 0, v: 0, to: 0 };
let shook = 0;
const timers: number[] = [];
let raf = 0;

const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)); };

/* ── the one loop ────────────────────────────────────────
   Runs while something moves and stops itself after, so a row nobody is
   typing into costs nothing. */
function wake() {
  if (raf) return;
  let prev = 0;
  const step = (t: number) => {
    const dt = prev ? clamp((t - prev) / 16.67, 0, 2.5) : 1;
    prev = t;
    let busy = false;

    /* the caret, on a spring with a little give */
    const target = Math.min(code.value.length, n.value - 1) * (W + G) + W / 2;
    if (still) { caret.x = target; caret.v = 0; }
    else {
      caret.v += (target - caret.x) * 0.2 * dt;
      caret.v *= Math.pow(0.62, dt);
      caret.x += caret.v * dt;
      if (Math.abs(target - caret.x) < 0.05 && Math.abs(caret.v) < 0.05) { caret.x = target; caret.v = 0; }
      else busy = true;
    }

    /* the merge, sprung */
    if (merge.m !== merge.to || merge.v !== 0) {
      if (still) { merge.m = merge.to; merge.v = 0; }
      else {
        merge.v += (merge.to - merge.m) * MERGE.k * dt;
        merge.v *= Math.pow(MERGE.d, dt);
        merge.m += merge.v * dt;
        if (Math.abs(merge.to - merge.m) < 0.0008 && Math.abs(merge.v) < 0.0008) { merge.m = merge.to; merge.v = 0; }
        else busy = true;
      }
    }

    if (t - shook < SHAKE_MS + 200) busy = true;

    tick.value++;
    /* a cell still swelling from a digit keeps the loop alive */
    if (popAt.some((at) => t - at < POP_MS)) busy = true;
    raf = busy ? requestAnimationFrame(step) : 0;
  };
  raf = requestAnimationFrame(step);
}

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  raf = 0;
  timers.forEach(window.clearTimeout);
});
onMounted(wake);
watch([code, n, phase], wake);

const fuse = (to: 0 | 1) => { merge.to = to; wake(); };

/* a row that has been answered, and a length knob moving under it, both start over */
watch(n, () => {
  code.value = '';
  phase.value = 'type';
  Object.assign(merge, { m: 0, v: 0, to: 0 });
});

function onChange(rawIn: string) {
  if (phase.value !== 'type') return;
  const next = rawIn.replace(/\D/g, '').slice(0, n.value);
  /* the field may hold what was typed (a letter); put back what we accepted */
  if (input.value && input.value.value !== next) input.value.value = next;
  /* each new digit swells its cell — a paste runs along the row */
  if (!still && next.length > code.value.length) {
    const t0 = performance.now();
    for (let i = code.value.length; i < next.length; i++) popAt[i] = t0 + (i - code.value.length) * 45;
    wake();
  }
  code.value = next;
  if (next.length < n.value) return;
  /* full: the real check, with a floor so it still reads as a check */
  phase.value = 'check';
  const t0 = performance.now();
  const floor = new Promise<void>((res) => later(res, still ? 0 : MIN_CHECK_MS));
  Promise.allSettled([props.onSubmit(next), floor]).then(([result]) => {
    const accepted = result.status === 'fulfilled' && result.value !== false;
    const wait = Math.max(0, MIN_CHECK_MS - (performance.now() - t0));
    later(() => {
      if (accepted) {
        phase.value = 'ok';
        fuse(1);
        input.value?.blur();
        /* let the capsule actually finish fusing and say "Verified" before
           whatever onVerified does — in this app, moving to a whole new
           screen — replaces this one. Calling it immediately would cut the
           one moment this component exists to show. */
        later(() => props.onVerified?.(), still ? 0 : 650);
      } else {
        phase.value = 'no';
        shook = performance.now();
        wake();
        later(() => { code.value = ''; phase.value = 'type'; nextTick(() => { if (input.value) input.value.value = ''; }); }, SHAKE_MS + n.value * 45 + 160);
      }
    }, still ? 0 : wait);
  });
}

/* pressing the capsule splits it back into empty cells */
function reopen() {
  if (phase.value !== 'ok') return;
  code.value = '';
  phase.value = 'type';
  fuse(0);
  if (input.value) input.value.value = '';
  input.value?.focus();
}
function onPointerDown(e: PointerEvent) {
  if (phase.value === 'ok') { e.preventDefault(); reopen(); }
}

/* ── where everything is this frame ──────────────────────── */
const f = computed(() => {
  void tick.value; // re-evaluate whenever the loop says something moved
  const now = performance.now();
  const count = n.value;
  /* the raw spring runs past 0 and 1; the cells' travel is clamped to it,
     and only the capsule is allowed to take the overshoot, as a stretch */
  const raw = merge.m;
  const m = clamp(raw, 0, 1);
  const mid = (rowW.value - W) / 2;
  const since = now - shook;
  const shaking = phase.value === 'no' && since < SHAKE_MS && !still;
  const shake = (i: number) =>
    shaking ? 5 * Math.exp(-since / 190) * Math.sin((since / 1000) * Math.PI * 2 * 10 + i * 0.55) : 0;
  const cellX = (i: number) => mix(i * (W + G), mid, m) + shake(i);
  /* ── a digit arriving ─────────────────────────────────────
     The cell that takes it swells a touch and settles: up and back on one
     half-sine, four per cent at the top. Small on purpose — it is an
     acknowledgement, not an event. */
  const pop = (i: number) => {
    const at = popAt[i];
    if (at === undefined) return 1;
    const u = (now - at) / POP_MS;
    return u > 0 && u < 1 ? 1 + 0.04 * Math.sin(Math.PI * u) : 1;
  };
  /* checking: a soft wave of breath through the cells */
  const breath = (i: number) => {
    if (phase.value !== 'check' || still) return pop(i);
    const u = ((now % 900) / 900) * (count + 2) - i;
    return 1 - 0.07 * (u > 0 && u < 2 ? Math.sin((u / 2) * Math.PI) : 0);
  };
  const over = raw - 1;
  /* long and thin past its size, round again as it settles: width and
     height trade, so it reads as one soft thing */
  const capW = CAP * smooth(0.3, 1, m) * (1 + Math.max(-0.12, over) * 0.9);
  const capSy = 1 - Math.max(-0.12, over) * 0.55;
  /* cells round off into the capsule's pill as they close in, so the two
     shapes agree by the time the goo joins them */
  const cellR = mix(r.value, H / 2, smooth(0.15, 0.7, m));
  const typing = phase.value === 'type' && focus.value;

  return {
    m, capW, capSy, cellR,
    cells: Array.from({ length: count }, (_, i) => ({ x: cellX(i), s: breath(i) })),
    slots: Array.from({ length: count }, (_, i) => {
      /* a wrong code drains right to left */
      const out = phase.value === 'no' && !still ? smooth(0, 1, (since - 300 - (count - 1 - i) * 45) / 220) : 0;
      return { x: cellX(i), out, digit: code.value[i] ?? '' };
    }),
    caretX: caret.x - 1,
    caretS: 1 + Math.min(5, Math.abs(caret.v) * 0.9),
    /* not until the cells have come apart again, or it stands in an empty
       slot the capsule is still on */
    caretOn: typing && code.value.length < count && m < 0.08,
    okOpacity: smooth(0.72, 1, m),
    okScale: mix(0.92, 1, smooth(0.72, 1, m)),
  };
});
</script>

<template>
  <div class="otp" :data-phase="phase">
    <div class="otp-row" :style="{ width: rowW + 'px', height: H + 'px' }">
      <!-- the cells and the capsule: one colour, under the filter -->
      <div class="otp-goo" aria-hidden="true" :style="{ filter: still ? undefined : `url(#${gooId})` }">
        <span
          v-for="(c, i) in f.cells" :key="i" class="otp-cell"
          :style="{ width: W + 'px', borderRadius: f.cellR + 'px', transform: `translateX(${c.x.toFixed(2)}px) scale(${c.s.toFixed(3)})` }"
        />
        <!-- always a full pill — the capsule is a result, not a cell, and wears the rounded shape whatever the corner says the cells are -->
        <span
          v-if="f.capW > 0.5" class="otp-cell"
          :style="{ width: f.capW + 'px', borderRadius: H / 2 + 'px', transform: `translateX(${((rowW - f.capW) / 2).toFixed(2)}px) scaleY(${f.capSy.toFixed(3)})` }"
        />
      </div>

      <!-- the digits — an empty cell is just the cell -->
      <span
        v-for="(s, i) in f.slots" :key="i" class="otp-slot"
        :style="{ width: W + 'px', transform: `translateX(${s.x.toFixed(2)}px)`, opacity: 1 - smooth(0, 0.45, f.m) }"
      >
        <span v-if="s.digit" :key="`${i}-${s.digit}`" class="otp-digit" :style="{ translate: `0 ${(s.out * 8).toFixed(2)}px`, opacity: 1 - s.out }">{{ s.digit }}</span>
      </span>

      <!-- the caret, stretched by its own speed -->
      <i class="otp-caret" :data-on="f.caretOn" :style="{ transform: `translateX(${f.caretX.toFixed(2)}px) scaleX(${f.caretS.toFixed(3)})` }" />

      <!-- what the capsule says -->
      <span class="otp-ok" :style="{ opacity: f.okOpacity, scale: String(f.okScale) }">
        <span class="lucide-check size-3.5" aria-hidden="true" />
        Verified
      </span>

      <input
        ref="input" class="otp-field" :value="code"
        inputmode="numeric" autocomplete="one-time-code" :maxlength="n" spellcheck="false"
        :aria-label="phase === 'ok' ? 'Verified. Press to enter a new code' : `${n}-digit code`"
        @input="onChange(($event.target as HTMLInputElement).value)"
        @focus="focus = true" @blur="focus = false"
        @pointerdown="onPointerDown"
      />
    </div>

    <svg class="liq-defs" aria-hidden="true" focusable="false">
      <defs>
        <filter :id="gooId" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
          <feGaussianBlur in="SourceGraphic" :stdDeviation="BLUR" result="smear" />
          <feColorMatrix in="smear" type="matrix" :values="`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${CUT} ${-(CUT / 2)}`" />
        </filter>
      </defs>
    </svg>
  </div>
</template>
