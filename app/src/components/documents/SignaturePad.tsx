import { useEffect, useRef, useState } from 'react';
import { PenLine, Upload, Trash2, Check } from 'lucide-react';
import { errorMessage } from '../../lib/errors';
import { getMySignatureUrl, uploadSignature } from '../../lib/documents';

// PRD.md §14.1 — register a signature once, reuse it on every document.
//
// The cleaning pass (background removal, tight crop) runs here in a canvas
// rather than in a service. It is a pure pixel transform on an image the user
// just supplied, it needs no secret, and doing it client-side keeps the photo
// of a signature off the server entirely — only the cleaned stamp is uploaded.

const CANVAS_W = 600;
const CANVAS_H = 200;

// Pixels lighter than this are treated as paper and dropped. Deliberately
// high: a phone photo of a signature on white paper is rarely pure white, and
// erring towards removal leaves a cleaner stamp than erring towards keeping
// a grey wash behind the ink.
const PAPER_LUMINANCE = 180;

// Turn whatever is on the canvas into a transparent, tightly-cropped stamp.
// Returns null when nothing survives — an empty pad, or a photo so dark that
// the whole frame reads as ink.
function cleanToStamp(source: HTMLCanvasElement): Promise<Blob | null> {
  const ctx = source.getContext('2d');
  if (!ctx) return Promise.resolve(null);

  const img = ctx.getImageData(0, 0, source.width, source.height);
  const d = img.data;

  let minX = source.width, minY = source.height, maxX = -1, maxY = -1;

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const i = (y * source.width + x) * 4;
      const alpha = d[i + 3];
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

      if (alpha < 16 || lum > PAPER_LUMINANCE) {
        d[i + 3] = 0;
        continue;
      }

      // Keep the ink, normalise it to a consistent dark stroke so a faint
      // pencil scan and a bold pen land looking like the same kind of mark.
      d[i] = 17; d[i + 1] = 24; d[i + 2] = 39;
      // Softer ink stays softer, which preserves stroke edges instead of
      // producing a jagged one-bit cutout.
      d[i + 3] = Math.min(255, Math.round((PAPER_LUMINANCE - lum) / PAPER_LUMINANCE * 255) + 60);

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return Promise.resolve(null);

  ctx.putImageData(img, 0, 0);

  const pad = 6;
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const w = Math.min(source.width - sx, maxX - minX + 1 + pad * 2);
  const h = Math.min(source.height - sy, maxY - minY + 1 + pad * 2);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')?.drawImage(source, sx, sy, w, h, 0, 0, w, h);

  return new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/png'));
}

export default function SignaturePad() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  const [current, setCurrent] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState<Blob | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMySignatureUrl()
      .then(setCurrent)
      .catch((err) => setError(errorMessage(err, 'Could not load your signature.')));
  }, []);

  const ctx2d = () => canvasRef.current?.getContext('2d') ?? null;

  // Pointer events rather than mouse+touch pairs: one code path covers a
  // stylus, a finger and a mouse, which is the whole point of signing on a
  // tablet.
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (CANVAS_W / rect.width),
      y: (e.clientY - rect.top) * (CANVAS_H / rect.height),
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const c = ctx2d();
    if (!c) return;
    const { x, y } = pos(e);
    c.beginPath();
    c.moveTo(x, y);
    drawing.current = true;
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const c = ctx2d();
    if (!c) return;
    const { x, y } = pos(e);
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = '#111827';
    c.lineTo(x, y);
    c.stroke();
    dirty.current = true;
  };

  const end = () => { drawing.current = false; };

  const clearPad = () => {
    ctx2d()?.clearRect(0, 0, CANVAS_W, CANVAS_H);
    dirty.current = false;
    setPending(null);
    setPreview(null);
    setMsg('');
  };

  const prepareFromCanvas = async () => {
    setError(''); setMsg('');
    if (!canvasRef.current || !dirty.current) {
      setError('Draw your signature first.');
      return;
    }
    // Clean a COPY. The pixel pass is destructive, and wiping the pad the
    // moment someone previews would lose a signature they may want to redraw.
    const copy = document.createElement('canvas');
    copy.width = CANVAS_W;
    copy.height = CANVAS_H;
    copy.getContext('2d')?.drawImage(canvasRef.current, 0, 0);

    const blob = await cleanToStamp(copy);
    if (!blob) { setError('Nothing to save — the pad looks empty.'); return; }
    setPending(blob);
    setPreview(URL.createObjectURL(blob));
  };

  const prepareFromFile = async (file: File) => {
    setError(''); setMsg('');
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('That file could not be read as an image.'));
        img.src = url;
      });

      // Cap the working size: a 12-megapixel phone photo would make the pixel
      // pass crawl for no gain — a stamp is a few hundred pixels wide.
      const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);

      const blob = await cleanToStamp(c);
      if (!blob) { setError('No signature found in that image — try a clearer photo.'); return; }
      setPending(blob);
      setPreview(URL.createObjectURL(blob));
    } catch (err) {
      setError(errorMessage(err, 'Could not read that image.'));
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const save = async () => {
    if (!pending) return;
    setError(''); setMsg(''); setBusy(true);
    try {
      await uploadSignature(pending);
      setCurrent(await getMySignatureUrl());
      setPending(null);
      setPreview(null);
      clearPad();
      setMsg('Signature saved. It will be stamped on documents you approve from now on.');
    } catch (err) {
      setError(errorMessage(err, 'Could not save your signature.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title"><PenLine size={18} /> Signature</h3>
      </div>
      <div className="card-body">
        <p className="text-muted" style={{ marginTop: 0 }}>
          Registered once and reused on every document you approve. Draw it below, or upload a photo
          of your signature on white paper — the background is removed automatically.
        </p>

        {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}
        {msg && <div className="alert alert-success" style={{ marginBottom: '1rem' }}>{msg}</div>}

        {current && !preview && (
          <div className="form-group">
            <label className="form-label">Current signature</label>
            <div style={{ padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}>
              <img src={current} alt="Your registered signature" style={{ maxHeight: 90 }} />
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">{current ? 'Replace it' : 'Draw your signature'}</label>
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
            style={{
              width: '100%', maxWidth: CANVAS_W, height: 'auto', aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
              border: '1px dashed var(--border)', borderRadius: 8, background: '#fff',
              touchAction: 'none', cursor: 'crosshair', display: 'block',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={clearPad}>
            <Trash2 size={16} /> Clear
          </button>
          <button type="button" className="btn btn-secondary" onClick={prepareFromCanvas}>
            <Check size={16} /> Use drawing
          </button>
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
            <Upload size={16} /> Upload photo
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                // Reset the input so re-picking the same file fires onChange.
                e.target.value = '';
                if (f) prepareFromFile(f);
              }}
            />
          </label>
        </div>

        {preview && (
          <div style={{ marginTop: '1rem' }}>
            <label className="form-label">Cleaned stamp — this is what will appear on documents</label>
            <div style={{ padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}>
              <img src={preview} alt="Cleaned signature preview" style={{ maxHeight: 90 }} />
            </div>
            <button type="button" className="btn btn-primary" style={{ marginTop: '0.75rem' }} onClick={save} disabled={busy}>
              {busy ? 'Saving...' : 'Save signature'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
