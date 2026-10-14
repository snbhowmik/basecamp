import { useEffect, useId, useRef, useState } from "react";
import { Check } from "lucide-react";

/* ══ One-time code ════════════════════════════════════════
   Six small cells and a caret. Digits rise into their cells;
   a right code draws the cells together until they fuse into
   one capsule that says so, and a wrong one sends a shiver
   down the row and drains the digits out.

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

   ── THE ANSWER IS A KNOB ────────────────────────────────
   A code nobody on the wall can know is not a demonstration.
   Accept and Reject are the two things the component does
   with a full row, so the panel picks which one you see.

   ── ADAPTED FOR BASECAMP ────────────────────────────────
   The demo's `answer` prop picked Accept/Reject synchronously,
   for the wall's own rehearsal. Here a full row calls `onSubmit`
   — the real TOTP check (wizard.ts's verifyTotp, which throws on
   a wrong code) — and the "check" phase waits on it instead of a
   fixed timer, with a 300ms floor so a network that answers
   instantly still reads as having checked rather than flashing. */

/* ── inlined from lab/motionkit ──────────────────────── */
/* ══ liquid ═══════════════════════════════════════════════
   Shared parts for the Framer Motion layer: one spring, one
   goo filter, one velocity→skew binding.

   ── why the filter is a hook ────────────────────────────
   The filter is embedded in each component's own return, but
   its id CANNOT be a literal. Every block here renders twice
   at once — once in the wall card, once in the detail overlay
   — and duplicate SVG ids do not scope, they collide: the
   second instance silently steals the first one's filter.
   useId() gives each mount its own name.

   ── what the goo can and cannot do ──────────────────────
   This is feGaussianBlur + feColorMatrix, not a shader. The
   matrix multiplies alpha by `cut` and subtracts half of it,
   so alpha below 0.5 lands on zero and everything above 0.536
   is fully opaque. That hard edge is what fuses nearby shapes
   into one blob — and it is also why this must never touch
   text: glyph antialiasing lives entirely below 0.5, so type
   under this filter loses its edges and then itself. */

function useGoo(blur = 7, cut = 28) {
  /* useId yields ":r0:" — legal in an id attribute but not in
     a url(#…) reference, so strip the colons. */
  const id = `goo-${useId().replace(/:/g, "")}`;
  const goo = (
    <svg className="liq-defs" aria-hidden="true" focusable="false">
      <defs>
        <filter
          id={id}
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="smear" />
          <feColorMatrix
            in="smear"
            type="matrix"
            values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${cut} ${-(cut / 2)}`}
          />
        </filter>
      </defs>
    </svg>
  );
  return { id, url: `url(#${id})`, goo };
}

/* ── inlined from lab/spring ──────────────────────── */
const stillness = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

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
const MERGE = (() => {
  const k = 0.075;
  const zeta = 0.42;
  return { k, d: 1 - 2 * zeta * Math.sqrt(k) };
})();
const SHAKE_MS = 620;
/* the real check's floor — see "Adapted for Basecamp" above */
const MIN_CHECK_MS = 300;

type Phase = "type" | "check" | "ok" | "no";

export function Otp({
  /* how many digits, 4 or 6 */
  length = 6,
  /* the cells' corner, px; the capsule wears the same one */
  corner = 12,
  /* the real check — resolves to accept, throws (or resolves
     false) to reject */
  onSubmit,
  /* fires once, after the capsule has settled on "ok" */
  onVerified,
}: {
  length?: number;
  corner?: number;
  onSubmit: (code: string) => Promise<boolean | void>;
  onVerified?: () => void;
} = {} as never) {
  const n = length === 4 ? 4 : 6;
  const r = clamp(corner, 0, H / 2);
  const rowW = n * W + (n - 1) * G;
  const still = stillness();

  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<Phase>("type");
  const [focus, setFocus] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  const caret = useRef({ x: W / 2, v: 0 });
  const popAt = useRef<number[]>([]);
  const merge = useRef({ m: 0, v: 0, to: 0 });
  const shook = useRef(0);
  const timers = useRef<number[]>([]);
  const raf = useRef(0);
  const [, setTick] = useState(0);
  const live = useRef({ code, n });
  live.current = { code, n };

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const wake = () => {
    if (raf.current) return;
    let prev = 0;
    const tick = (t: number) => {
      const dt = prev ? clamp((t - prev) / 16.67, 0, 2.5) : 1;
      prev = t;
      let busy = false;
      const { code: c, n: count } = live.current;

      const target = Math.min(c.length, count - 1) * (W + G) + W / 2;
      const k = caret.current;
      if (still) { k.x = target; k.v = 0; }
      else {
        k.v += (target - k.x) * 0.2 * dt;
        k.v *= Math.pow(0.62, dt);
        k.x += k.v * dt;
        if (Math.abs(target - k.x) < 0.05 && Math.abs(k.v) < 0.05) { k.x = target; k.v = 0; }
        else busy = true;
      }

      const mg = merge.current;
      if (mg.m !== mg.to || mg.v !== 0) {
        if (still) { mg.m = mg.to; mg.v = 0; }
        else {
          mg.v += (mg.to - mg.m) * MERGE.k * dt;
          mg.v *= Math.pow(MERGE.d, dt);
          mg.m += mg.v * dt;
          if (Math.abs(mg.to - mg.m) < 0.0008 && Math.abs(mg.v) < 0.0008) { mg.m = mg.to; mg.v = 0; }
          else busy = true;
        }
      }

      if (t - shook.current < SHAKE_MS + 200) busy = true;

      setTick((x) => x + 1);
      if (popAt.current.some((at) => t - at < POP_MS)) busy = true;
      raf.current = busy ? requestAnimationFrame(tick) : 0;
    };
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    timers.current.forEach(window.clearTimeout);
  }, []);
  useEffect(() => { wake(); }, [code, n, phase]);

  const fuse = (to: 0 | 1) => {
    merge.current = { ...merge.current, to };
    wake();
  };

  useEffect(() => {
    setCode("");
    setPhase("type");
    merge.current = { m: 0, v: 0, to: 0 };
  }, [n]);

  const onChange = (raw: string) => {
    if (phase !== "type") return;
    const next = raw.replace(/\D/g, "").slice(0, n);
    if (!still && next.length > code.length) {
      const t0 = performance.now();
      for (let i = code.length; i < next.length; i++) popAt.current[i] = t0 + (i - code.length) * 45;
      wake();
    }
    setCode(next);
    if (next.length < n) return;
    setPhase("check");
    const t0 = performance.now();
    const floor = new Promise<void>((res) => later(res, still ? 0 : MIN_CHECK_MS));
    Promise.allSettled([onSubmit(next), floor]).then(([result]) => {
      const accepted = result.status === "fulfilled" && result.value !== false;
      const elapsed = performance.now() - t0;
      const wait = Math.max(0, MIN_CHECK_MS - elapsed);
      later(() => {
        if (accepted) {
          setPhase("ok");
          fuse(1);
          input.current?.blur();
          /* let the capsule actually finish fusing and say "Verified"
             before whatever onVerified does — in this app, moving to a
             whole new screen — replaces this one. Calling it immediately
             would cut the one moment this component exists to show. */
          later(() => onVerified?.(), still ? 0 : 650);
        } else {
          setPhase("no");
          shook.current = performance.now();
          wake();
          later(() => {
            setCode("");
            setPhase("type");
          }, SHAKE_MS + n * 45 + 160);
        }
      }, still ? 0 : wait);
    });
  };

  const reopen = () => {
    if (phase !== "ok") return;
    setCode("");
    setPhase("type");
    fuse(0);
    input.current?.focus();
  };

  const now = performance.now();
  const raw = merge.current.m;
  const m = clamp(raw, 0, 1);
  const em = m;
  const home = (i: number) => i * (W + G);
  const mid = (rowW - W) / 2;
  const since = now - shook.current;
  const shaking = phase === "no" && since < SHAKE_MS && !still;
  const shake = (i: number) =>
    shaking ? 5 * Math.exp(-since / 190) * Math.sin((since / 1000) * Math.PI * 2 * 10 + i * 0.55) : 0;
  const cellX = (i: number) => mix(home(i), mid, em) + shake(i);
  const pop = (i: number) => {
    const at = popAt.current[i];
    if (at === undefined) return 1;
    const u = (now - at) / POP_MS;
    return u > 0 && u < 1 ? 1 + 0.04 * Math.sin(Math.PI * u) : 1;
  };
  const breath = (i: number) => {
    if (phase !== "check" || still) return pop(i);
    const u = ((now % 900) / 900) * (n + 2) - i;
    return 1 - 0.07 * (u > 0 && u < 2 ? Math.sin((u / 2) * Math.PI) : 0);
  };
  const over = raw - 1;
  const capW = CAP * smooth(0.3, 1, m) * (1 + Math.max(-0.12, over) * 0.9);
  const capSy = 1 - Math.max(-0.12, over) * 0.55;
  const cellR = mix(r, H / 2, smooth(0.15, 0.7, m));
  const typing = phase === "type" && focus;

  const { url, goo } = useGoo(3, 24);

  return (
    <div className="otp" data-phase={phase}>
      <div className="otp-row" style={{ width: rowW, height: H }}>
        <div className="otp-goo" aria-hidden="true" style={{ filter: still ? undefined : url }}>
          {Array.from({ length: n }, (_, i) => (
            <span
              key={i}
              className="otp-cell"
              style={{
                width: W,
                borderRadius: cellR,
                transform: `translateX(${cellX(i).toFixed(2)}px) scale(${breath(i).toFixed(3)})`,
              }}
            />
          ))}
          {capW > 0.5 && (
            <span
              className="otp-cell"
              style={{
                width: capW,
                borderRadius: H / 2,
                transform: `translateX(${((rowW - capW) / 2).toFixed(2)}px) scaleY(${capSy.toFixed(3)})`,
              }}
            />
          )}
        </div>

        {Array.from({ length: n }, (_, i) => {
          const d = code[i];
          const x = cellX(i);
          const out = phase === "no" && !still ? smooth(0, 1, (since - 300 - (n - 1 - i) * 45) / 220) : 0;
          return (
            <span
              key={i}
              className="otp-slot"
              style={{
                width: W,
                transform: `translateX(${x.toFixed(2)}px)`,
                opacity: 1 - smooth(0, 0.45, m),
              }}
            >
              {d && (
                <span
                  key={`${i}-${d}`}
                  className="otp-digit"
                  style={{ translate: `0 ${(out * 8).toFixed(2)}px`, opacity: 1 - out }}
                >
                  {d}
                </span>
              )}
            </span>
          );
        })}

        <i
          className="otp-caret"
          data-on={typing && code.length < n && m < 0.08}
          style={{
            transform: `translateX(${(caret.current.x - 1).toFixed(2)}px) scaleX(${(1 + Math.min(5, Math.abs(caret.current.v) * 0.9)).toFixed(3)})`,
          }}
        />

        <span className="otp-ok" style={{ opacity: smooth(0.72, 1, m), scale: `${mix(0.92, 1, smooth(0.72, 1, m))}` }}>
          <Check size={14} strokeWidth={2.4} aria-hidden="true" />
          Verified
        </span>

        <input
          ref={input}
          className="otp-field"
          value={code}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onPointerDown={(e) => { if (phase === "ok") { e.preventDefault(); reopen(); } }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={n}
          aria-label={phase === "ok" ? "Verified. Press to enter a new code" : `${n}-digit code`}
          spellCheck={false}
          autoFocus
        />
      </div>
      {goo}
    </div>
  );
}
