import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import Brand from '../ui/Brand';
import { useMediaQuery, AUTH_PANEL_QUERY } from '../../lib/useMediaQuery';
import { getInviteByToken, acceptInvite, type InviteDetails } from '../../lib/invites';
import { enrollTotp, verifyTotp } from '../../lib/wizard';

// Staff/faculty onboarding via a dedicated /invite/<token> link — see
// README.md's V2 notes and get_invite_by_token() in
// 0005_public_registration.sql. Same account-creation + mandatory-MFA
// shape as the captain's own first-boot flow, just without the org-setup
// steps (those are captain-only, one-time).
export default function AcceptInvite({ token, onDone }: { token: string; onDone: () => void }) {
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [step, setStep] = useState<'form' | 'confirm' | 'mfa'>('form');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');

  useEffect(() => {
    getInviteByToken(token)
      .then(setInvite)
      .catch(() => setInvite(null))
      .finally(() => setLoading(false));
  }, [token]);

  const run = async (fn: () => Promise<void>) => {
    setError('');
    setSubmitting(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const beginMfa = async () => {
    const enrolled = await enrollTotp();
    setFactorId(enrolled.id);
    setQrCode(enrolled.totp.qr_code);
    setSecret(enrolled.totp.secret);
    setStep('mfa');
  };

  const resumedRef = useRef(false);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user && !resumedRef.current && step !== 'form') {
        resumedRef.current = true;
        run(beginMfa);
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!invite) return;
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    run(async () => {
      await acceptInvite(invite.email, fullName, password);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setStep('confirm');
        return;
      }
      await beginMfa();
    });
  };

  const handleVerifyConfirmCode = (e: FormEvent) => {
    e.preventDefault();
    if (!invite) return;
    run(async () => {
      const { error: verifyErr } = await supabase.auth.verifyOtp({ email: invite.email, token: confirmCode, type: 'signup' });
      if (verifyErr) throw verifyErr;
      await beginMfa();
    });
  };

  const handleVerifyTotp = (e: FormEvent) => {
    e.preventDefault();
    if (!factorId) return;
    run(async () => {
      await verifyTotp(factorId, totpCode);
      onDone();
    });
  };

  if (loading) {
    return (
      <div className="auth-wrapper" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="auth-wrapper" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <h1 className="auth-title">Invite not found</h1>
          <p className="auth-subtitle">This link is invalid, already used, or has been revoked. Contact whoever invited you.</p>
        </div>
      </div>
    );
  }

  const wideEnoughForPanel = useMediaQuery(AUTH_PANEL_QUERY);

  return (
    <div className="auth-wrapper">
      <div className="auth-side">
        <div className="bg-pattern" />
        <div className="auth-side-content">
          <h2>BaseCamp</h2>
          <p>
            You've been invited as <strong>{invite.levelName}</strong>
            {invite.orgUnitName ? <> in <strong>{invite.orgUnitName}</strong></> : null}
            {invite.invitedByName ? <> by {invite.invitedByName}</> : null}.
          </p>
        </div>
        <div className="auth-side-mark">
          <Brand variant="white" height={58} />
        </div>
      </div>
      <div className="auth-content">
        <div className="auth-card" style={{ maxWidth: 480 }}>
          <div className="auth-header">
            {!wideEnoughForPanel && (
              <div className="auth-logo"><Brand height={34} /></div>
            )}
            <h1 className="auth-title">
              {step === 'form' ? 'Complete your account' : step === 'confirm' ? 'Check your email' : 'Enroll multi-factor authentication'}
            </h1>
            <p className="auth-subtitle">
              {step === 'form' && invite.email}
              {step === 'confirm' && `Enter the 6-digit code sent to ${invite.email}.`}
              {step === 'mfa' && 'Mandatory, cannot be skipped.'}
            </p>
          </div>

          {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}

          {step === 'form' && (
            <form onSubmit={handleSubmit} className="auth-form">
              <div className="form-group">
                <label className="form-label">Full name</label>
                <input className="form-input" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input type="password" className="form-input" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Creating...' : 'Continue'} <ArrowRight size={18} />
              </button>
            </form>
          )}

          {step === 'confirm' && (
            <form onSubmit={handleVerifyConfirmCode} className="auth-form">
              <div className="form-group">
                <label className="form-label">6-digit code</label>
                <input
                  className="form-input"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoFocus
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.5rem' }}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Verifying...' : 'Verify'} <ArrowRight size={18} />
              </button>
            </form>
          )}

          {step === 'mfa' && (
            <form onSubmit={handleVerifyTotp} className="auth-form">
              {qrCode && (
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ padding: '1rem', background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                    <img src={qrCode} alt="Scan with your authenticator app" width={180} height={180} />
                  </div>
                </div>
              )}
              {secret && (
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
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.5rem' }}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Verifying...' : 'Verify & finish'} <ShieldCheck size={18} />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
