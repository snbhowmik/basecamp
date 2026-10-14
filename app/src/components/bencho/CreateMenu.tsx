import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { FileText, Plus } from "lucide-react";

/* ══ Liquid ═══════════════════════════════════════════════
   Three metaball studies: a toggle, a reorderable list, and
   a create menu.

   RECONSTRUCTED. The original file was destroyed; this is
   rebuilt against the surviving stylesheet, which specifies
   the geometry, the layering and the timing exactly. The
   behaviour matches what index.css and the catalog demos
   require. The original's internal reasoning is not
   recoverable and is not reproduced here.

   ── the shared constraint ───────────────────────────────
   Everything on a filtered layer must be OPAQUE. The goo
   filter thresholds alpha, so a translucent fill under it
   disappears. That is why each of these has two layers: an
   opaque blob layer that carries the filter, and an unfiltered
   layer above it carrying the text — antialiased type would
   be eaten by the same threshold.

   ── ADAPTED FOR BASECAMP ────────────────────────────────
   The demo's menu is four fixed item types (Document,
   Spreadsheet, Board, Folder). This app's "create" action is
   "raise a request in category X", and the category list is
   configured by the captain, not fixed at four — so `items` is
   a prop here instead of the module-level ITEMS constant, and
   the panel's height is derived from however many categories
   there are rather than hardcoded for four rows. Selecting a
   row calls `onPick(item)` instead of just closing the menu. */

const LIQUID_STILL = { type: "spring" as const, stiffness: 420, damping: 30 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const CRT_CORNER = 28;
const CRT_MAX = 40;
/* row height + its own gap, and the panel's own padding — the
   numbers the original's fixed 166px (four rows) came from */
const ROW_H = 34;
const ROW_GAP = 2;
const PANEL_PAD = 22;
const PANEL_W = 212;

export interface CreateMenuItem {
  key: string;
  label: string;
}

export function Create({
  corner = CRT_CORNER,
  label = "Create",
  items,
  onPick,
}: {
  corner?: number;
  label?: string;
  items: CreateMenuItem[];
  onPick: (item: CreateMenuItem) => void;
} = {} as never) {
  const [open, setOpen] = useState(false);
  const [sink, setSink] = useState(false);

  const panel = useRef<HTMLDivElement | null>(null);
  const say = useRef<HTMLSpanElement | null>(null);
  const beat = useRef(0);

  const [sayW, setSayW] = useState(96);

  useLayoutEffect(() => {
    const el = say.current;
    if (!el) return;
    let live = true;
    const measure = () => { if (live) setSayW(el.offsetWidth + 1); };
    measure();
    document.fonts?.ready.then(measure).catch(() => {});
    return () => { live = false; };
  }, [label]);

  useEffect(() => () => {
    window.clearTimeout(beat.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!e.isTrusted) return;
      const box = panel.current
        ?.querySelector(".crt-panel")
        ?.getBoundingClientRect();
      const on =
        !!box &&
        e.clientX >= box.left && e.clientX <= box.right &&
        e.clientY >= box.top && e.clientY <= box.bottom;
      if (!on) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const press = () => {
    setSink(true);
    window.clearTimeout(beat.current);
    beat.current = window.setTimeout(() => {
      setSink(false);
      setOpen(true);
    }, 60);
  };

  const pillW = 18 + 8 + sayW + 34;
  const panelH = Math.max(ROW_H, items.length * ROW_H + Math.max(0, items.length - 1) * ROW_GAP) + PANEL_PAD;

  const panelR = clamp(corner, 0, CRT_MAX);
  const shutR = Math.min(19, panelR * (19 / CRT_CORNER));

  return (
    <motion.div
      className="crt-stage"
      data-open={open || undefined}
      data-sink={sink || undefined}
      ref={panel}
      style={{
        "--pill-w": `${pillW}px`,
        "--panel-w": `${PANEL_W}px`,
        "--panel-h": `${panelH}px`,
        "--crt-r": `${clamp(corner, 0, CRT_MAX)}px`,
        "--crt-shut-r": `${Math.min(19, clamp(corner, 0, CRT_MAX) * (19 / CRT_CORNER)).toFixed(2)}px`,
        "--crt-row-r": `${Math.min(17, Math.max(0, clamp(corner, 0, CRT_MAX) - 10)).toFixed(2)}px`,
      } as React.CSSProperties}
    >
      <div className="crt-blobs" aria-hidden="true">
        <motion.div
          className="crt-body"
          animate={{
            width: open ? PANEL_W : pillW,
            height: open ? panelH : 38,
            borderRadius: open ? panelR : shutR,
          }}
          transition={LIQUID_STILL}
        />
      </div>

      <button className="crt-pill" onClick={press} aria-expanded={open}>
        <span className="crt-glyph" aria-hidden="true">
          <Plus size={16} strokeWidth={2} />
        </span>
        <span className="crt-say" style={{ width: sayW || undefined }}>
          <span ref={say}>{label}</span>
        </span>
      </button>

      <div className="crt-panel">
        <ul className="crt-menu">
          {items.map((it, i) => (
            <li
              className="crt-item"
              key={it.key}
              style={{ transitionDelay: open ? `${30 + i * 22}ms` : "0ms" }}
            >
              <button
                onClick={() => { setOpen(false); onPick(it); }}
              >
                <FileText size={15} strokeWidth={2} />
                {it.label}
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="crt-item">
              <span className="crt-empty">No categories configured yet</span>
            </li>
          )}
        </ul>
      </div>
    </motion.div>
  );
}
