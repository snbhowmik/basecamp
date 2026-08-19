import { useEffect, useState, type FormEvent } from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, Search } from 'lucide-react';
import { errorMessage } from '../../lib/errors';
import { verifyDocument, type VerificationResult } from '../../lib/documents';
import Brand from '../ui/Brand';

interface VerifyPageProps {
  code?: string;
}

// The public verification page — PRD.md §14.4.
//
// Deliberately reachable without an account: someone holding a printed
// document must be able to check it. It shows only whether the record exists,
// whether the request still matches what was signed, and who signed it. Never
// the document's contents — otherwise a reference code would be a way to read
// somebody else's ticket.
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
                  A signed document is hashed against the request's data. That data no longer matches, so this
                  printout does not reflect what was approved. Treat it as void and ask for a fresh copy.
                </p>
              )}
              {(result.signatures ?? []).length > 0 && (
                <ul className="verify-signers">
                  {result.signatures!.map((s, i) => (
                    <li key={i}>
                      Signed by <strong>{s.signer}</strong>{s.role ? ` (${s.role})` : ''} on{' '}
                      {new Date(s.signed_at).toLocaleDateString()}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
