<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { animate, motionValue } from 'motion';

/* ══ Slide to confirm ═════════════════════════════════════
   A handle you push across a track. It follows the finger
   exactly, and past the mark it takes over and finishes the
   journey itself.

   Bencho's "Slide to confirm", MIT (bencho.dev/licence), ported from
   React + framer-motion to Vue + `motion` (the same animation engine
   framer-motion is built on). The comments are theirs.

   THE HANDLE BECOMES THE ANSWER. On commit it does not hand
   over to a tick somewhere else — it unfurls leftward and
   fills the track it was crossing, and the arrow it was
   carrying becomes a check. One object changing shape, which
   is the case a morph is actually for, and the reason this
   needs no second element to say "done".

   The right edge does not move while that happens: the width
   grows by exactly what the offset loses. So the handle
   arrives, plants itself, and opens out behind it.

   ── ADAPTED FOR BASECAMP ────────────────────────────────
   The demo commits the instant the handle crosses the mark —
   there's nothing behind it to wait on. Here, crossing the mark
   calls the real `onConfirm` (the approve RPC) and the handle
   HOLDS at the end, unfurled no further, until it resolves: only
   a real success plays the "Confirmed" morph. A rejection — the
   outstanding-tasks check, a stale decision, anything RLS
   refuses — springs the handle back home and surfaces the
   message through `onError`, the same as every other action in
   this app reports a failure. An approval is not something this
   component gets to promise on the network's behalf.

   ── PORTED TO VUE ───────────────────────────────────────
   framer's `useTransform` derives values from a motion value inside the
   render. Here the same derivations live in `sync()`, which runs whenever
   one of the four motion values changes and writes the result into one
   reactive `v` object the template reads. Same arithmetic, same values,
   one place. */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const SPAN = 280;
const H = 56;
/* the inset the handle keeps from the track, all four sides */
const PAD = 4;
/* the handle is a circle in a 56 track, so it is sized by the
   HEIGHT and the width knob does not touch it. Widening the
   track buys travel, not a longer handle — the thing you push
   stays the thing you push. */
const GRIP = H - PAD * 2;
/* the shortest track worth drawing. Below this the centred
   label starts to sit under the resting handle, which is the
   one collision this layout has. */
const MIN = 220;
const MAX = 380;

/* a pill, and the top of the Corner knob */
const CORNER = H / 2;
const SPEED = 50;

/* ── how far the swell is, and it is TINY ──────────────────
   The dot sits four pixels inside the track, so the ring round
   it is the whole budget for a hover. 3% of 48 is 1.4, which
   is 0.7 a side and leaves 3.3. */
const SWELL = 1.03;

/* how long the finished state stands before it resets. It has
   to reset: a slide that stayed confirmed would show every
   later visitor a component with nothing to do. */
const HOLD = 1500;

const props = withDefaults(defineProps<{
  /* the track's corner, px. The handle's is this less the inset, which is the concentric rule. */
  corner?: number;
  /* how quickly it takes over once you let go, 0..100 */
  speed?: number;
  /* the track's length, px */
  width?: number;
  /* what the track says before it is pushed */
  label?: string;
  /* the real action. Resolving plays the morph; throwing (or a rejected promise) springs the handle home and calls onError. */
  onConfirm: () => Promise<void>;
  onError?: (message: string) => void;
}>(), { corner: 28, speed: 50, width: 280, label: 'Slide to approve' }); // = CORNER, SPEED, SPAN (a props default cannot read setup constants)

const done = ref(false);
const held = ref(false);
/* the real action is in flight: the handle is held at the wall, waiting */
const pending = ref(false);
const hot = ref(false);
const track = ref<HTMLElement | null>(null);
/* the live grab. A plain object rather than reactive state: it changes on every frame of a gesture, which is exactly the value that must not render. */
let grip: { id: number; grab: number | null; moved: boolean } | null = null;
let beat = 0;

const x = motionValue(0);
/* ── where the handle planted itself ─────────────────────
   Zero except while it is unfurling, and then it is the offset the
   handle had when it committed. The width is `GRIP + (anchor - x)`, so
   PAD + x + width comes to PAD + GRIP + anchor — a number with no x in it.
   The right edge is therefore stationary BY ARITHMETIC rather than by two
   animations agreeing. (It was two, and the right edge measured 6.8px of
   wobble across the morph. One value read twice cannot do that.) */
const anchor = motionValue(0);
/* ── the settle ──────────────────────────────────────────
   The unfurl ends with the handle exactly filling the track and nothing
   else happening, which reads as the animation stopping rather than as the
   thing landing. A dip of about three per cent and back gives it somewhere
   to arrive. On the TRACK, so the whole block gives at once. Its own
   clock rather than the spring's, and the peak sits late, at 0.62, so the
   block gathers as it lands instead of pulsing before it. */
const pulse = motionValue(1);
/* the arrow's own fade, so it can leave on the COMMIT rather than on x */
const shown = motionValue(1);

/* ── the width is READ EVERY RENDER, not captured ────────── */
const span = computed(() => clamp(Math.round(props.width), MIN, MAX));
const TRAVEL = computed(() => span.value - PAD * 2 - GRIP);

const r = computed(() => clamp(props.corner, 0, CORNER));
/* ── the handle's corner is DERIVED ──────────────────────
   `r - PAD`, floored at zero: the radius of a thing inside another, less
   the gap between them, is what keeps the two curves parallel. */
const gripR = computed(() => Math.max(0, r.value - PAD));
/* ── the end IS the commit, and there is no knob ─────────
   A slide-to-confirm that fires at 60% is one you can trigger by knocking
   the handle, which is the single thing the gesture exists to prevent. The
   only honest answer is the end of the track. */
const mark = computed(() => TRAVEL.value);

/* ── SPEED, and deliberately not Bounce ──────────────────
   This shape has a hard wall at both ends. On commit the handle exactly
   fills the track, so there is nowhere for an overshoot to go. Speed is
   the real question here, and the damping is derived to sit exactly on
   critical, so nothing overshoots at any setting of it.
   zeta = c / (2 * sqrt(k * m)), so c at zeta 1 is 2 * sqrt(k * m). */
const stiff = computed(() => 260 + (clamp(props.speed, 0, 100) / 100) * 640);
/* the COMMIT stays exactly on critical. */
const spring = computed(() => ({ type: 'spring' as const, stiffness: stiff.value, damping: 2 * Math.sqrt(stiff.value * 0.9), mass: 0.9 }));
/* ── the RETURN is not ───────────────────────────────────
   0.62 of critical, so it arrives with something left over rather than
   stopping dead. The overshoot never shows as movement — `seen` clamps the
   position at the wall — it shows as the squash, which is the same energy
   spent somewhere it fits. */
const home = computed(() => ({ ...spring.value, damping: 2 * Math.sqrt(stiff.value * 0.9) * 0.62 }));

/* ── everything else is read off x ───────────────────────
   The wash behind the handle, the label giving up its ink, and the arrow
   fading as the end approaches are readings of one number rather than
   things animated toward the same moment. */
const v = reactive({ seen: 0, wide: GRIP, squash: 1, wash: GRIP, say: 1, arrow: 1, sx: 1, sy: 1, pulse: 1 });

function sync() {
  const T = TRAVEL.value;
  /* both readings clamp: `seen` is what the transform uses; `x` stays the honest value the drag wrote */
  const seen = clamp(x.get(), 0, T);
  v.seen = seen;
  v.wide = GRIP + clamp(anchor.get() - seen, 0, T);
  /* ── the overshoot becomes a SQUASH ──────────────────────
     The return spring is under-damped, so it wants to carry past zero — and
     it cannot: at zero the handle is already against the end of its track.
     So the position clamps and the energy that would have carried it past
     turns into compression instead, which reads as a soft landing rather
     than a stop. 8% is the ceiling; any real landing reaches it. Origin at
     the LEFT edge, because that is the wall it hit. */
  const over = Math.max(0, -x.get());
  v.squash = 1 - Math.min(0.08, over / 110);
  v.wash = seen + GRIP;
  v.say = clamp(1 - seen / (T * 0.55), 0, 1);
  /* ── AND IT ANSWERS THE COMMIT, not just x ───────────────
     Read off x alone this faded back IN during the unfurl: committing sends
     x home to zero, so the arrow reappeared underneath the word it had just
     been replaced by. `shown` is switched by the commit itself. */
  v.arrow = shown.get() * clamp(1 - (seen - T * 0.55) / (T * 0.4), 0, 1);
  /* both scales ride the same product — the swell is multiplied INTO the
     transform rather than set as its own `scale`, which would move the
     handle along the track it is sitting on */
  const swell = hot.value && !held.value && !done.value && !pending.value ? SWELL : 1;
  v.sx = v.squash * swell;
  v.sy = (1 / v.squash) * swell;
  v.pulse = pulse.get();
}
const unsub: (() => void)[] = [];
onMounted(() => { for (const m of [x, anchor, shown, pulse]) unsub.push(m.on('change', sync)); sync(); });
watch([hot, held, done, pending, TRAVEL], sync);

/* ── THE DRAG IS FOLLOWED ON THE WINDOW ──────────────────
   It used to be followed on the track, with pointer capture to keep the
   events coming once the cursor left it. Capture is best-effort: a browser
   can drop it mid-gesture when a touch turns into a system gesture or the
   pointer leaves the window, and then the release lands on some other
   element, the track never hears it, and the handle sits held at the far
   end forever. Listening on the window removes the dependency: a release
   ANYWHERE ends the drag — which is what a slider promises.

   ── AND IT IS BOUND AT THE PRESS, NOT IN AN EFFECT ───────
   An effect does not run until the framework has committed the render, and a
   fast flick can put its first pointermove in that gap. That first move is
   the one that sets the grab offset, so losing it means the whole drag does
   nothing. Bound inside `down`, they are live on the same tick as the press. */
let loose: (() => void) | null = null;
function watchWindow() {
  loose?.();
  const onMove = (e: PointerEvent) => move(e);
  const onUp = (e: PointerEvent) => { up(e); loose?.(); };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  loose = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    loose = null;
  };
}

onBeforeUnmount(() => {
  window.clearTimeout(beat);
  loose?.();
  unsub.forEach((u) => u());
});

function local(clientX: number) {
  const box = track.value?.getBoundingClientRect();
  if (!box) return 0;
  /* a pointer delta in screen pixels is not a delta in the component's own
     if it is drawn scaled; the rect's width against the width it is laid out
     at IS that scale */
  const k = box.width / span.value;
  return (clientX - box.left) / (k || 1);
}

function finish() {
  done.value = true;
  /* ── x goes to ZERO, and that is the whole morph ────────
     The handle is placed by `x` and sized by `width`, and on commit they
     move by the same amount in opposite directions: x loses TRAVEL, width
     gains it. Their sum is the right edge, so the right edge does not move —
     the handle plants itself where it arrived and opens out behind it. */
  anchor.set(x.get());
  animate(shown, 0, { duration: 0.12 });
  animate(x, 0, spring.value);
  animate(pulse, [1, 0.974, 1], {
    duration: 0.46,
    times: [0, 0.62, 1],
    ease: [0.33, 0.55, 0.2, 1],
    /* a beat behind the unfurl, so it is the landing that dips rather than the take-off */
    delay: 0.1,
  });
  beat = window.setTimeout(() => {
    done.value = false;
    animate(shown, 1, { duration: 0.2, delay: 0.12 });
    /* the reset is the anchor coming home with x already at zero: the width shrinks from the full track back to the handle, so the RIGHT edge sweeps left to the start. The unfurl played backwards. */
    animate(anchor, 0, { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 });
  }, HOLD);
}

/* the real call said no: spring the handle home from the wall it was holding at, the same as letting go short of the mark */
function refuse(message: string) {
  pending.value = false;
  animate(x, 0, home.value);
  props.onError?.(message);
}

function down(e: PointerEvent) {
  if (done.value || pending.value) return;
  e.stopPropagation();
  /* ── NO OFFSET YET, it is taken at the first MOVE ───────
     Deciding it here is what made the toggle teleport: a press away from the
     handle would set the offset to the handle's own middle, and the first
     move then jumped it the whole way in one frame. */
  grip = { id: e.pointerId, grab: null, moved: false };
  held.value = true;
  /* it throws if the id is not a live pointer, and the drag works without it */
  try { track.value?.setPointerCapture(e.pointerId); } catch { /* not live */ }
  watchWindow();
}

function move(e: PointerEvent) {
  const g = grip;
  if (!g || g.id !== e.pointerId) return;
  const at = local(e.clientX);
  if (g.grab === null) { g.grab = at - x.get(); return; }
  const next = clamp(at - g.grab, 0, TRAVEL.value);
  if (Math.abs(next - x.get()) > 0.5) g.moved = true;
  x.set(next);
}

function up(e: PointerEvent) {
  const g = grip;
  if (!g) return;
  grip = null;
  /* ── AND THE RELEASE IS GUARDED TOO ────────────────────
     It throws when the pointer was never captured, and unguarded it threw
     before `held` cleared, leaving the handle stuck wherever the drag ended. */
  try { track.value?.releasePointerCapture?.(e.pointerId); } catch { /* never captured */ }
  held.value = false;
  if (x.get() >= mark.value) {
    /* held at the wall — x stays at TRAVEL, nothing unfurls — until the real call answers */
    x.set(TRAVEL.value);
    pending.value = true;
    props.onConfirm()
      .then(() => { pending.value = false; finish(); })
      .catch((err) => refuse(err instanceof Error ? err.message : 'Could not approve this request.'));
  } else {
    animate(x, 0, home.value);
  }
}
</script>

<template>
  <div class="sld" :style="{ width: span + 'px', height: H + 'px' }">
    <div
      ref="track" class="sld-track"
      :style="{ borderRadius: r + 'px', transform: `scale(${v.pulse})` }"
      :data-held="held || undefined" :data-done="done || undefined" :data-pending="pending || undefined"
      @pointerdown="down"
    >
      <!-- the part already crossed. It is not a progress bar — it is the ground the handle has covered, which is why it ends AT the handle rather than under it -->
      <i class="sld-wash" aria-hidden="true" :style="{ width: v.wash + 'px', borderRadius: gripR + 'px' }" />

      <span class="sld-say" :style="{ opacity: v.say }">{{ label }}</span>

      <button
        type="button" class="sld-grip"
        :style="{
          transform: `translateX(${v.seen}px) scale(${v.sx}, ${v.sy})`,
          /* ── the morph, and it is ONE number ───────────
             `wide` is read off x and the anchor, so the width is not being animated at all — it is arithmetic on the value the spring is already moving. A scale would have dragged the corner radius with it, which is the one thing this shape cannot afford. */
          width: v.wide + 'px',
          borderRadius: gripR + 'px',
        }"
        :aria-label="done ? 'Confirmed' : label"
        @pointerenter="hot = true" @pointerleave="hot = false"
      >
        <span class="sld-arrow" :style="{ opacity: v.arrow }" aria-hidden="true"><span class="lucide-arrow-right size-5" /></span>

        <!-- the word only exists once there is room for it, and it arrives with the width rather than after it -->
        <span
          class="sld-done" aria-hidden="true"
          :style="{ opacity: done ? 1 : 0, transform: `scale(${done ? 1 : 0.7})`, transition: 'opacity 180ms cubic-bezier(0.33,0.55,0.2,1), transform 180ms cubic-bezier(0.33,0.55,0.2,1)' }"
        ><span class="lucide-check size-5" /> Confirmed</span>
      </button>
    </div>
  </div>
</template>
