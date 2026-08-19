import { errorMessage } from '../../lib/errors';
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
  // Must sit with the other hooks, above every early return below. React
  // counts hooks per render: when this was called after the `loading` and
  // `!invite` guards, a valid invite added a hook on the render where the
  // details arrived, and React tore the tree down with "rendered more hooks
  // than during the previous render" — a blank page, no error on screen.
  const wideEnoughForPanel = useMediaQuery(AUTH_PANEL_QUERY);
  const resumedRef = useRef(false);

  const [lookupFailed, setLookupFailed] = useState(false);

  // Order matters: session first, invite row second.
  //
  // apply_pending_assignment() consumes the invite the moment the account is
  // created, which is *before* the invitee clicks the confirmation link. So on
  // the way back from that link the invite row is already spent and
  // get_invite_by_token() returns nothing. Keying this screen on the invite
  // row therefore sent a legitimately confirmed user back to a signup form for
  // an account they already had. Once a session exists the invite has done its
  // job and is irrelevant — what is left is finishing MFA.
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal?.currentLevel === 'aal2') {
          onDone();
          return;
        }
        resumedRef.current = true;
        try {
          await beginMfa();
        } catch (err) {
          setError(errorMessage(err, 'Could not start MFA enrollment.'));
        }
        setLoading(false);
        return;
      }

      try {
        setInvite(await getInviteByToken(token));
      } catch {
        // A failed lookup is not the same as a consumed or unknown token, and
        // showing "invite not found" for both hides real outages behind a
        // message telling the invitee to go pester whoever invited them.
        setLookupFailed(true);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const run = async (fn: () => Promise<void>) => {
    setError('');
    setSubmitting(true);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong.'));
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

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // No `step !== 'form'` guard any more. It meant a cold page load — which
      // always starts at 'form' — ignored a perfectly good session, which is
      // exactly the state a user is in when they arrive from the confirmation
      // link.
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user && !resumedRef.current) {
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
      await acceptInvite(invite.email, fullName, password, token);
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
          <h1 className="auth-title">{lookupFailed ? 'Could not check this invite' : 'Invite not found'}</h1>
          <p className="auth-subtitle">
            {lookupFailed
              ? 'The server could not be reached. Try again in a moment — the link itself may be fine.'
              : 'This link is invalid, already used, or has been revoked. Contact whoever invited you.'}
          </p>
        </div>
      </div>
    );
  }

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
