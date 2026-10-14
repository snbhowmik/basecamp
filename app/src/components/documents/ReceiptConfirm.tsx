import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import type { RequestRow } from '../../lib/requests';

// A submission confirmation styled as a receipt printing out — the
// mechanism (not the code) is dqnamo.com's "Receipt Printer" experiment:
// a dark processing card, then a white perforated strip sliding out from
// underneath it carrying the real line items. Original implementation,
// not a copy of their source — this app's version shows the request's
// actual category, title, reference number and submitted date instead of
// an order total, and the barcode is a deterministic decorative pattern
// derived from the reference number rather than their own asset.
//
// No real printer, no real barcode scanner reads this — same as the
// reference, the "barcode" is decoration that makes the strip read as a
// receipt, not a functional code. The thing that actually resolves a
// request is its reference number in text, and the QR on the generated
// document once it's approved (DocumentView.tsx), not this.
function decorativeBars(seed: string): number[] {
  // A short, deterministic sequence of bar widths (1-4) from the
  // reference number's character codes — not random, so the same request
  // always draws the same "barcode" rather than a new one each render.
  const bars: number[] = [];
  for (let i = 0; i < 40; i++) {
    const code = seed.charCodeAt(i % seed.length) + i;
    bars.push(1 + (code % 4));
  }
  return bars;
}

export default function ReceiptConfirm({ request, onDone }: { request: RequestRow; onDone: () => void }) {
  const [printed, setPrinted] = useState(false);

  useEffect(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = window.setTimeout(() => setPrinted(true), still ? 0 : 650);
    return () => window.clearTimeout(t);
  }, []);

  const bars = decorativeBars(request.reference_number);
  const submitted = request.submitted_at ?? request.created_at;

  return (
    <div className="modal-overlay" onClick={printed ? onDone : undefined}>
      <div className="receipt-stage" onClick={(e) => e.stopPropagation()}>
        <div className="receipt-card">
          <div className="receipt-card-row">
            <strong>{request.request_categories?.name ?? 'Request'}</strong>
          </div>
          <div className="receipt-card-sub">{request.title}</div>
          <div className="receipt-card-status">
            {!printed ? (
              <><span className="loading-spinner" style={{ width: '1rem', height: '1rem' }} /> Printing your receipt…</>
            ) : (
              <>Submitted</>
            )}
          </div>
        </div>

        <div className={`receipt-paper ${printed ? 'receipt-paper--out' : ''}`}>
          <div className="receipt-paper-inner">
            <div className="receipt-line receipt-line--head">
              <span>{request.request_categories?.name ?? 'Request'}</span>
            </div>
            <div className="receipt-line">
              <span>Title</span><span>{request.title}</span>
            </div>
            <div className="receipt-rule" />
            <div className="receipt-line">
              <span>Reference</span><span className="cell-mono">{request.reference_number}</span>
            </div>
            <div className="receipt-line">
              <span>Submitted</span><span className="cell-mono">{new Date(submitted).toLocaleString()}</span>
            </div>
            <svg className="receipt-barcode" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
              {bars.map((w, i) => {
                const x = bars.slice(0, i).reduce((a, b) => a + b + 1, 0);
                return <rect key={i} x={x} y={0} width={w} height={24} fill="currentColor" />;
              })}
            </svg>
            <div className="receipt-line--tag">{request.reference_number}</div>
          </div>
        </div>

        {printed && (
          <button type="button" className="btn btn-primary receipt-done" onClick={onDone}>
            <Printer size={15} /> Done
          </button>
        )}
      </div>
    </div>
  );
}
