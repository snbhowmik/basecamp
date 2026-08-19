import { useState, type FormEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from './Modal';
import { reverifyTotp } from '../../lib/admin';

// Two deliberate acts before anything is destroyed: type the record's name,
// then a fresh code from the authenticator.
//
// Typing the name is the part that defends against the wrong row — a
// yes/no dialog answers "do you want to delete something", not "did you mean
// this one". The code defends against an unattended session, and is checked by
// the database rather than here: reverifyTotp() mints a token carrying a fresh
// totp timestamp, and admin_delete() refuses without one.

export default function ConfirmDestructive({
  title, recordName, description, onCancel, onConfirmed,
}: {
  title: string;
  recordName: string;
  description?: string;
  onCancel: () => void;
  onConfirmed: () => Promise<void>;
}) {
  const [typed, setTyped] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const nameMatches = typed.trim() === recordName.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!nameMatches || code.length < 6) return;
    setBusy(true);
    setError('');
    try {
      await reverifyTotp(code);
      await onConfirmed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete the deletion.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onCancel}
      title={title}
      maxWidth="480px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-danger" onClick={submit} disabled={busy || !nameMatches || code.length < 6}>
            {busy ? 'Deleting...' : 'Delete permanently'}
          </button>
        </>
      }
    >
      <div className="alert alert-warning" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
        <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          {description ?? 'This cannot be undone.'} If anything still references this record the
          database will refuse the deletion and tell you what is using it.
        </span>
      </div>

      <form onSubmit={submit}>
        <div className="form-group">
          <label className="form-label">Type <strong>{recordName}</strong> to confirm</label>
          <input className="form-input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">Authenticator code</label>
          <input
            className="form-input"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            disabled={!nameMatches}
          />
          <span className="form-hint">Required for every deletion, not once per session.</span>
        </div>
        {error && <div className="alert alert-danger">{error}</div>}
      </form>
    </Modal>
  );
}
