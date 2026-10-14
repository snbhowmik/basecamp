import { useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";

/* ══ Slide to confirm ═════════════════════════════════════
   A handle you push across a track. It follows the finger
   exactly, and past the mark it takes over and finishes the
   journey itself.

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
   component gets to promise on the network's behalf. */

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
   is 0.7 a side and leaves 3.3 — the liquid toggle's note is
   the long version of this arithmetic. */
const SWELL = 1.03;

/* how long the finished state stands before it resets. */
const HOLD = 1500;

export function SlideConfirm({
  /* the track's corner, px. The handle's is this less the
     inset, which is the concentric rule every nested pair on
     this bench follows. */
  corner = CORNER,
  /* how quickly it takes over once you let go, 0..100 */
  speed = SPEED,
  /* the track's length, px. */
  width = SPAN,
  /* what the track says before it is pushed */
  label = "Slide to approve",
  /* the real action. Resolving plays the morph; throwing (or a
     rejected promise) springs the handle home and calls onError. */
  onConfirm,
  onError,
}: {
  corner?: number;
  speed?: number;
  width?: number;
  label?: string;
  onConfirm: () => Promise<void>;
  onError?: (message: string) => void;
} = {} as never) {
  const [done, setDone] = useState(false);
  const [held, setHeld] = useState(false);
  const [hot, setHot] = useState(false);
  /* holding at the wall while the real call is in flight — the
     one phase the original component never had a reason to have */
  const [pending, setPending] = useState(false);
  const track = useRef<HTMLDivElement | null>(null);
  const grip = useRef<{ id: number; grab: number | null; moved: boolean } | null>(null);
  const beat = useRef(0);

  const x = useMotionValue(0);
  const anchor = useMotionValue(0);
  const pulse = useMotionValue(1);
  const shown = useMotionValue(1);

  const span = clamp(Math.round(width), MIN, MAX);
  const TRAVEL = span - PAD * 2 - GRIP;

  const r = clamp(corner, 0, CORNER);
  const gripR = Math.max(0, r - PAD);
  const mark = TRAVEL;

  const stiff = 260 + (clamp(speed, 0, 100) / 100) * 640;
  const spring = {
    type: "spring" as const,
    stiffness: stiff,
    damping: 2 * Math.sqrt(stiff * 0.9),
    mass: 0.9,
  };
  const home = { ...spring, damping: 2 * Math.sqrt(stiff * 0.9) * 0.62 };

  useEffect(() => () => {
    window.clearTimeout(beat.current);
    loose.current?.();
  }, []);

  const loose = useRef<(() => void) | null>(null);
  const live = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
  }>({ move: () => {}, up: () => {} });

  const watch = () => {
    loose.current?.();
    const onMove = (e: PointerEvent) => live.current.move(e);
    const onUp = (e: PointerEvent) => { live.current.up(e); loose.current?.(); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    loose.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      loose.current = null;
    };
  };

  const seen = useTransform(x, (v) => clamp(v, 0, TRAVEL));
  const wide = useTransform([seen, anchor], ([v, a]: number[]) =>
    GRIP + clamp(a - v, 0, TRAVEL));

  const over = useTransform(x, (v) => Math.max(0, -v));
  const squash = useTransform(over, (o) => 1 - Math.min(0.08, o / 110));
  const wash = useTransform(seen, (v) => v + GRIP);
  const say = useTransform(seen, [0, TRAVEL * 0.55], [1, 0]);
  const arrow = useTransform([seen, shown], ([v, on]: number[]) =>
    on * clamp(1 - (v - TRAVEL * 0.55) / (TRAVEL * 0.4), 0, 1));

  const sx = useTransform(squash, (q) => q * (hot && !held && !done ? SWELL : 1));
  const sy = useTransform(squash, (q) => (1 / q) * (hot && !held && !done ? SWELL : 1));

  const local = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box) return 0;
    const k = box.width / span;
    return (clientX - box.left) / (k || 1);
  };

  const finish = () => {
    setDone(true);
    anchor.set(x.get());
    animate(shown, 0, { duration: 0.12 });
    animate(x, 0, spring);
    animate(pulse, [1, 0.974, 1], {
      duration: 0.46,
      times: [0, 0.62, 1],
      ease: [0.33, 0.55, 0.2, 1],
      delay: 0.1,
    });
    beat.current = window.setTimeout(() => {
      setDone(false);
      animate(shown, 1, { duration: 0.2, delay: 0.12 });
      animate(anchor, 0, { type: "spring", stiffness: 380, damping: 34, mass: 0.9 });
    }, HOLD);
  };

  /* the real call lost: spring the handle back from the wall it
     was holding at, the same as letting go short of the mark */
  const refuse = (message: string) => {
    setPending(false);
    animate(x, 0, home);
    onError?.(message);
  };

  const down = (e: React.PointerEvent) => {
    if (done || pending) return;
    e.stopPropagation();
    grip.current = { id: e.pointerId, grab: null, moved: false };
    setHeld(true);
    try { track.current?.setPointerCapture(e.pointerId); } catch { /* not live */ }
    watch();
  };

  const move = (e: PointerEvent | React.PointerEvent) => {
    const g = grip.current;
    if (!g || g.id !== e.pointerId) return;
    const at = local(e.clientX);
    if (g.grab === null) { g.grab = at - x.get(); return; }
    const next = clamp(at - g.grab, 0, TRAVEL);
    if (Math.abs(next - x.get()) > 0.5) g.moved = true;
    x.set(next);
  };

  const up = (e: PointerEvent | React.PointerEvent) => {
    const g = grip.current;
    if (!g) return;
    grip.current = null;
    try { track.current?.releasePointerCapture?.(e.pointerId); } catch { /* never captured */ }
    setHeld(false);
    if (x.get() >= mark) {
      /* held at the wall — x stays at TRAVEL, nothing unfurls —
         until the real call answers */
      x.set(TRAVEL);
      setPending(true);
      onConfirm()
        .then(() => { setPending(false); finish(); })
        .catch((err) => refuse(err instanceof Error ? err.message : "Could not approve this request."));
    } else {
      animate(x, 0, home);
    }
  };

  live.current = { move, up };

  return (
    <div className="sld" style={{ width: span, height: H }}>
      <motion.div
        className="sld-track"
        ref={track}
        style={{ borderRadius: r, scale: pulse }}
        data-held={held || undefined}
        data-done={done || undefined}
        data-pending={pending || undefined}
        onPointerDown={down}
      >
        <motion.i
          className="sld-wash"
          aria-hidden="true"
          style={{ width: wash, borderRadius: gripR }}
        />

        <motion.span className="sld-say" style={{ opacity: say }}>
          {label}
        </motion.span>

        <motion.button
          type="button"
          className="sld-grip"
          onPointerEnter={() => setHot(true)}
          onPointerLeave={() => setHot(false)}
          style={{
            x: seen,
            scaleX: sx,
            scaleY: sy,
            width: wide,
            borderRadius: gripR,
          }}
          transition={{ type: "spring", stiffness: 400, damping: 30, mass: 0.7 }}
          aria-label={done ? "Approved" : pending ? "Approving…" : label}
        >
          {!pending && (
            <motion.span className="sld-arrow" style={{ opacity: arrow }} aria-hidden="true">
              <ArrowRight size={20} strokeWidth={2.4} />
            </motion.span>
          )}

          {pending && !done && (
            <span className="sld-pending" aria-hidden="true">
              <span className="sld-spinner" />
            </span>
          )}

          <motion.span
            className="sld-done"
            aria-hidden="true"
            initial={false}
            animate={{ opacity: done ? 1 : 0, scale: done ? 1 : 0.7 }}
            transition={{ duration: 0.18, ease: [0.33, 0.55, 0.2, 1] }}
          >
            <Check size={19} strokeWidth={2.8} />
            Approved
          </motion.span>
        </motion.button>
      </motion.div>
    </div>
  );
}
