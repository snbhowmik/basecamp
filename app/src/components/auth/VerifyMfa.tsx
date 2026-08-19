import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { errorMessage } from '../../lib/errors';
import Brand from '../ui/Brand';
import { useMediaQuery, AUTH_PANEL_QUERY } from '../../lib/useMediaQuery';
import { enrollTotp, verifyTotp } from '../../lib/wizard';

interface VerifyMfaProps {
  /** A verified factor to challenge, or null to enroll one first. */
  factorId: string | null;
  onVerified: () => void;
  onSignOut: () => void;
}

// The step-up screen for a session that holds a password but not a second
// factor. This is a full screen reached from App.tsx's bootstrap, not a piece
// of local state inside a form — which is what the bug was. LoginForm used to
// hold the TOTP step in React state, so signing in and refreshing skipped it
// entirely while the aal1 session sat in localStorage, fully usable.
//
// It covers both aal1 cases in one place:
//   factorId set   — challenge the existing factor.
//   factorId null  — the account never finished enrolling (an interrupted
//                    signup or invite). The database allows this session to
//                    act until a factor is verified, so the only safe exit is
//                    to enroll here rather than show a dead end.
export default function VerifyMfa({ factorId, onVerified, onSignOut }: VerifyMfaProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const enrolling = factorId === null;
  const [newFactorId, setNewFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');

  const startedRef = useRef(false);
  useEffect(() => {
    if (factorId !== null || startedRef.current) return;
    startedRef.current = true;
    enrollTotp()
      .then((enrolled) => {
        setNewFactorId(enrolled.id);
        setQrCode(enrolled.totp.qr_code);
        setSecret(enrolled.totp.secret);
      })
      .catch((err) => setError(errorMessage(err, 'Could not start enrollment.')));
  }, [factorId]);

  const target = factorId ?? newFactorId;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setError('');
    setBusy(true);
    try {
      await verifyTotp(target, code);
      onVerified();
    } catch (err) {
      setError(errorMessage(err, 'Verification failed.'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const wideEnoughForPanel = useMediaQuery(AUTH_PANEL_QUERY);

  return (
    <div className="auth-wrapper">
      <div className="auth-side">
        <div className="bg-pattern" />
        <div className="auth-side-content">
          <h2>BaseCamp</h2>
          <p>A request and ticketing platform. Track less. Manage better — built for your organisation.</p>
        </div>
        <div className="auth-side-mark">
          <Brand variant="white" height={58} />
        </div>
      </div>
      <div className="auth-content">
        <div className="auth-card">
          <div className="auth-header">
            {!wideEnoughForPanel && (
              <div className="auth-logo"><Brand height={34} /></div>
            )}
            <h1 className="auth-title">{enrolling ? 'Set up two-factor authentication' : 'Verify your identity'}</h1>
            <p className="auth-subtitle">
              {enrolling
                ? 'This account has no authenticator yet. Scan the code below to finish setting one up.'
                : 'Enter the 6-digit code from your authenticator app to continue.'}
            </p>
          </div>

          {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}

          <form onSubmit={handleSubmit} className="auth-form">
            {enrolling && qrCode && (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <div style={{ padding: '1rem', background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <img src={qrCode} alt="Scan with your authenticator app" width={180} height={180} />
                </div>
              </div>
            )}
            {enrolling && secret && (
              <div className="form-group">
                <label className="form-label">Can't scan? Enter this key manually</label>
                <code style={{ fontSize: '0.85rem', wordBreak: 'break-all', background: 'var(--bg-color)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem 1rem', display: 'block' }}>
                  {secret}
                </code>
              </div>
            )}
            <div className="form-group">
              <label className="form-label">6-digit code</label>
              <input
                className="form-input"
                required
                autoFocus
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.5rem' }}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy || !target}>
              {busy ? 'Verifying...' : 'Verify'} <ShieldCheck size={18} />
            </button>
          </form>

          {/* Without this a lost authenticator is a locked browser: nothing
              else on this screen can reach the app, and the session is not
              signed out. */}
          <div className="auth-footer">
            Lost your authenticator?{' '}
            <button type="button" className="auth-link" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </div>
    </div>
  );
}
