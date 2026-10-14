import { useEffect, useState, type FormEvent } from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, Search } from 'lucide-react';
import { errorMessage } from '../../lib/errors';
import { verifyDocument, type VerificationResult } from '../../lib/documents';
import Brand from '../ui/Brand';
import Stamp from '../ui/Stamp';

interface VerifyPageProps {
  code?: string;
}

// Same deterministic decorative pattern as ReceiptConfirm.tsx — a visual
// cue that this is a receipt, never a real scannable barcode.
function decorativeBars(seed: string): number[] {
  const bars: number[] = [];
  for (let i = 0; i < 40; i++) {
    const code = seed.charCodeAt(i % seed.length) + i;
    bars.push(1 + (code % 4));
  }
  return bars;
}

// The public verification page — PRD.md §14.4.
//
// Deliberately reachable without an account: someone holding a printed
// document, or scanning the QR code printed on it, must be able to check
// whether it is genuine with no login. Never the document's contents —
// otherwise a reference code would be a way to read somebody else's ticket.
//
// Signer detail is NOT gated by login (0036, reversing 0035's narrower
// tiering): the approver's identity is the stamp on the document, and a
// stamp is meant to be checked by anyone holding it, not only someone
// signed in. verify_document() returns the full signer list to every
// caller; this page renders the last one who signed as Stamp.tsx.
export default function VerifyPage({ code }: VerifyPageProps) {
  const [input, setInput] = useState(code ?? '');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (value: string) => {
    setError('');
    setResult(null);
    if (!value.trim()) return;
    setBusy(true);
    try {
      setResult(await verifyDocument(value.trim()));
    } catch (err) {
      setError(errorMessage(err, 'Could not check that code.'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (code) run(code); }, [code]);

  const onSubmit = (e: FormEvent) => { e.preventDefault(); run(input); };

  return (
    <div className="verify-wrapper">
      <div className="verify-card">
        <div className="auth-logo"><Brand height={34} /></div>
        <h1 className="auth-title">Verify a document</h1>
        <p className="auth-subtitle">
          Enter the reference code printed on the document to confirm it is genuine.
        </p>

        <form onSubmit={onSubmit} className="auth-form">
          <div className="form-group">
            <label className="form-label">Reference code</label>
            <input
              className="form-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. 4F2A…"
              autoFocus
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <Search size={16} /> {busy ? 'Checking…' : 'Check'}
          </button>
        </form>

        {error && <div className="alert alert-danger" style={{ marginTop: '1rem' }}>{error}</div>}

        {result && !result.found && (
          <div className="verify-result verify-bad">
            <ShieldX size={28} />
            <div>
              <strong>No such document.</strong>
              <p>No record matches that reference code. It may be mistyped, or the document may not be genuine.</p>
            </div>
          </div>
        )}

        {result?.found && (
          <div className={`verify-result ${result.intact ? 'verify-good' : 'verify-warn'}`}>
            {result.intact ? <ShieldCheck size={28} /> : <ShieldAlert size={28} />}
            <div>
              <strong>
                {result.intact
                  ? 'Genuine — and unchanged since it was signed.'
                  : 'Genuine record, but the request has changed since it was signed.'}
              </strong>
              <p>
                {result.doc_type} · issued {result.issued_at ? new Date(result.issued_at).toLocaleDateString() : '—'}
              </p>
              {!result.intact && (
                <p>
                  A signed document is hashed against the request's data, and that data has changed since — so
                  this printout no longer reflects what was approved. That is not proof of forgery: a request
                  sent back for changes and resubmitted will also read this way. Ask the holder for a freshly
                  generated copy, which will carry a new reference code.
                </p>
              )}
              {(result.signatures ?? []).length > 0 && (
                <>
                  <div className="receipt-paper-inner verify-receipt-body">
                    <div className="receipt-line receipt-line--head"><span>Approval record</span></div>
                    <div className="receipt-rule" />
                    {result.signatures!.map((s, i) => (
                      <div key={i}>
                        <div className="receipt-line">
                          <span>{s.stage || s.role || 'Approval'}</span>
                          <span className="cell-mono">{s.signer}</span>
                        </div>
                        <div className="receipt-line receipt-line--sub">
                          <span>{s.role && s.role !== s.stage ? s.role : ''}</span>
                          <span className="cell-mono">{new Date(s.signed_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                    <div className="receipt-rule" />
                    <svg className="receipt-barcode" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
                      {decorativeBars(input.trim().toUpperCase()).map((w, i, bars) => {
                        const x = bars.slice(0, i).reduce((a, b) => a + b + 1, 0);
                        return <rect key={i} x={x} y={0} width={w} height={24} fill="currentColor" />;
                      })}
                    </svg>
                    <div className="receipt-line--tag">{input.trim().toUpperCase()}</div>
                  </div>
                  {(() => {
                    const last = result.signatures![result.signatures!.length - 1];
                    return (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                        <Stamp
                          role={last.stage || last.role || 'Approved'}
                          name={last.signer}
                          date={new Date(last.signed_at).toLocaleDateString()}
                          punch={result.intact ? 'var(--state-approved-wash)' : 'var(--state-pending-wash)'}
                        />
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
