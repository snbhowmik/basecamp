import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, X, ShieldCheck, MailCheck } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import {
  createCaptainAccount,
  enrollTotp,
  verifyTotp,
  addAllowedDomains,
  ensureDomainAllowed,
} from '../../lib/wizard';

type Step = 1 | 2 | 3;

export default function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Step 1 — captain account
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // True once signUp() succeeds but returns no session — GOTRUE_MAILER_AUTOCONFIRM
  // is "false" in any real deployment, so signup requires the captain to click
  // the email confirmation link before a session (and MFA enrollment) exists.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  // Step 2 — MFA
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');

  // Step 3 — domains
  const [domains, setDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState('');

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

  // Called once a session actually exists for the captain — either right
  // after signUp() (autoconfirm on, local dev) or once they've clicked the
  // email confirmation link and come back (real deployment). Resumes at
  // step 2, or skips ahead to step 3 if MFA was already completed in an
  // earlier attempt.
  // The captain's own id is not tracked here any more: setup_levels() resolves
  // it from auth.uid() when the levels page runs.
  const resumeFromSession = async (_user: User) => {
    setAwaitingConfirmation(false);
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === 'aal2') {
      setStep(3);
      return;
    }
    const enrolled = await enrollTotp();
    setFactorId(enrolled.id);
    setQrCode(enrolled.totp.qr_code);
    setSecret(enrolled.totp.secret);
    setStep(2);
  };

  // Resumes automatically whenever a session already exists: confirming via
  // the emailed link lands the captain back on this same origin with tokens
  // in the URL (supabase-js parses that and fires SIGNED_IN), and a plain
  // page reload mid-wizard fires INITIAL_SESSION for whatever's already in
  // localStorage — without this, a reload would lose all component state
  // and show Step 1 again even though the account already exists, and
  // clicking through would try to sign up the same email a second time.
  // resumedRef (not state) guards against acting twice — this effect's
  // closure only runs once on mount, so a state-based guard would always
  // see its initial value.
  const resumedRef = useRef(false);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user && !resumedRef.current) {
        resumedRef.current = true;
        run(() => resumeFromSession(session.user));
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateCaptain = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    run(async () => {
      const user = await createCaptainAccount(fullName, email, password);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setAwaitingConfirmation(true);
        return;
      }
      await resumeFromSession(user);
    });
  };

  const handleCheckConfirmed = () => {
    run(async () => {
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) throw new Error("Not confirmed yet — check your email and click the link, then try again.");
      await resumeFromSession(data.user);
    });
  };

  // The confirmation email includes a 6-digit code as an alternative to the
  // link — verifying it directly is more robust than depending on the
  // link's redirect routing (external URL/proxy config) being exactly
  // right, and confirms + signs in in one step.
  const [confirmCode, setConfirmCode] = useState('');
  const handleVerifyConfirmCode = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const { data, error: verifyErr } = await supabase.auth.verifyOtp({
        email,
        token: confirmCode,
        type: 'signup',
      });
      if (verifyErr) throw verifyErr;
      if (!data.user) throw new Error('Verification did not return a user.');
      await resumeFromSession(data.user);
    });
  };

  const handleVerifyTotp = (e: FormEvent) => {
    e.preventDefault();
    if (!factorId) return;
    run(async () => {
      await verifyTotp(factorId, totpCode);
      setStep(3);
    });
  };

  const addDomain = () => {
    const d = domainInput.trim().toLowerCase();
    if (d && !domains.includes(d)) {
      setDomains([...domains, d]);
      setDomainInput('');
    }
  };

  // Last step. The captain's own domain is registered here rather than before
  // signup: in v2 allowed_login_domains is covered by the config write policy,
  // which needs can_bootstrap() and therefore a session. The first signup
  // bypasses the domain check entirely, so nothing needed it earlier.
  const handleDomainsSubmit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await ensureDomainAllowed(email.trim());
      await addAllowedDomains(domains);
      onComplete();
    });
  };





  return (
    <div className="wizard-wrapper">
      <div className="wizard-card">
        <div className="wizard-steps">
          {[1, 2, 3].map((n) => (
            <div key={n} className={`wizard-step-dot ${step === n ? 'active' : step > n ? 'done' : ''}`} />
          ))}
        </div>

        {error && (
          <div className="alert alert-danger" style={{ margin: '1.5rem 2rem 0' }}>
            {error}
          </div>
        )}

        {step === 1 && awaitingConfirmation && (
          <form onSubmit={handleVerifyConfirmCode}>
            <div className="wizard-body">
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <MailCheck size={48} color="var(--primary)" />
              </div>
              <div style={{ textAlign: 'center' }}>
                <h1 className="page-title">Check your email</h1>
                <p className="page-subtitle">
                  We sent a confirmation link to <strong>{email}</strong> — clicking it will bring you
                  back here automatically. Or enter the 6-digit code from the same email below.
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">6-digit confirmation code</label>
                <input
                  className="form-input"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  placeholder="000000"
                  autoFocus
                />
              </div>
            </div>
            <div className="wizard-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setAwaitingConfirmation(false)} disabled={submitting}>
                Back
              </button>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" className="btn btn-secondary" onClick={handleCheckConfirmed} disabled={submitting}>
                  {submitting ? 'Checking...' : "I clicked the link"}
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting || confirmCode.length !== 6}>
                  {submitting ? 'Verifying...' : 'Verify code'}
                </button>
              </div>
            </div>
          </form>
        )}

        {step === 1 && !awaitingConfirmation && (
          <form onSubmit={handleCreateCaptain}>
            <div className="wizard-body">
              <div>
                <h1 className="page-title">Create the captain account</h1>
                <p className="page-subtitle">Step 1 of 3 — the captain is the only account created outside the normal sign-up flow. Every other account (Dean, HOD, Mentor, Student, ...) is created by hand afterward, inside the app.</p>
              </div>
              <div className="form-group">
                <label className="form-label">Full name</label>
                <input className="form-input" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input type="email" className="form-input" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="captain@yourdomain.edu" />
                <span className="form-hint">This email's domain is automatically added to the allowed sign-up domains.</span>
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input type="password" className="form-input" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
            <div className="wizard-footer">
              <span className="form-hint">MFA enrollment is next — it's mandatory and cannot be skipped.</span>
              <button className="btn btn-primary" type="submit" disabled={submitting}>
                {submitting ? 'Creating...' : 'Continue'}
              </button>
            </div>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleVerifyTotp}>
            <div className="wizard-body">
              <div>
                <h1 className="page-title">Enroll multi-factor authentication</h1>
                <p className="page-subtitle">Step 2 of 3 — scan this QR code with an authenticator app, then enter the 6-digit code.</p>
              </div>
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
                  <code
                    style={{
                      fontSize: '0.9rem',
                      wordBreak: 'break-all',
                      background: 'var(--bg-color)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: '0.75rem 1rem',
                      display: 'block',
                    }}
                  >
                    {secret}
                  </code>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">6-digit code</label>
                <input
                  className="form-input"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="000000"
                  autoFocus
                  style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.5rem', fontWeight: 600 }}
                />
              </div>
            </div>
            <div className="wizard-footer">
              <span className="form-hint" style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <ShieldCheck size={16} /> Cannot be skipped
              </span>
              <button className="btn btn-primary" type="submit" disabled={submitting}>
                {submitting ? 'Verifying...' : 'Verify & Continue'}
              </button>
            </div>
          </form>
        )}

        {step === 3 && (
          <form onSubmit={handleDomainsSubmit}>
            <div className="wizard-body">
              <div>
                <h1 className="page-title">Allowed sign-up domains</h1>
                <p className="page-subtitle">Step 3 of 3 — only these email domains will be able to register. {email.split('@')[1]} is already allowed (your captain account).</p>
              </div>
              <div className="form-group">
                <label className="form-label">Add another domain</label>
                <div className="repeatable-row">
                  <input
                    className="form-input"
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    placeholder="students.yourdomain.edu"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDomain(); } }}
                  />
                  <button type="button" className="btn btn-secondary" onClick={addDomain}>
                    <Plus size={16} />
                  </button>
                </div>
              </div>
              <div className="chip-list">
                {domains.map((d) => (
                  <span key={d} className="chip">
                    {d}
                    <button type="button" onClick={() => setDomains(domains.filter((x) => x !== d))}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <div className="wizard-footer">
              <span />
              <button className="btn btn-primary" type="submit" disabled={submitting}>
                {submitting ? 'Saving...' : 'Finish setup'}
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}
