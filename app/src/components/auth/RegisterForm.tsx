import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import Brand from '../ui/Brand';
import { useMediaQuery, AUTH_PANEL_QUERY } from '../../lib/useMediaQuery';
import {
  selfRegisterStudent,
  listPublicDepartments,
  listPublicBatches,
  type PublicOption,
} from '../../lib/invites';
import { enrollTotp, verifyTotp } from '../../lib/wizard';

// Public student self-registration — see README.md's V2 notes and
// 0005_public_registration.sql. Creates a base-level account only; staff
// accounts are invite-only (AcceptInvite.tsx), never through this form.
export default function RegisterForm({ onDone, onSwitchToLogin }: { onDone: () => void; onSwitchToLogin: () => void }) {
  const [step, setStep] = useState<'form' | 'confirm' | 'mfa'>('form');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [regNo, setRegNo] = useState('');
  const [departments, setDepartments] = useState<PublicOption[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [classes, setClasses] = useState<PublicOption[]>([]);
  const [classId, setClassId] = useState('');
  const [catalogError, setCatalogError] = useState('');

  const [confirmCode, setConfirmCode] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');

  useEffect(() => {
    listPublicDepartments()
      .then((d) => {
        setDepartments(d);
        // An empty catalog is a real, actionable state — say so rather than
        // rendering an empty dropdown, which is exactly what made the RLS
        // bug behind this look like "nothing happened".
        if (d.length === 0) {
          setCatalogError('No departments have been set up yet. Ask your administrator to add them before registering.');
        }
      })
      .catch((err) => {
        setDepartments([]);
        setCatalogError(err instanceof Error ? err.message : 'Could not load departments.');
      });
  }, []);

  useEffect(() => {
    if (!departmentId) {
      setClasses([]);
      setClassId('');
      return;
    }
    listPublicBatches(departmentId).then(setClasses).catch(() => setClasses([]));
  }, [departmentId]);

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

  // Resume on reload / after confirming via the emailed link, same pattern
  // as SetupWizard — see its comment for why a ref, not state, guards this.
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
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!departmentId || !regNo.trim()) {
      setError('Department and registration number are required.');
      return;
    }
    run(async () => {
      await selfRegisterStudent({ fullName, email, password, departmentId, classId: classId || null, regNo });
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
    run(async () => {
      const { error: verifyErr } = await supabase.auth.verifyOtp({ email, token: confirmCode, type: 'signup' });
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

  const wideEnoughForPanel = useMediaQuery(AUTH_PANEL_QUERY);

  return (
    <div className="auth-wrapper">
      <div className="auth-side">
        <div className="bg-pattern" />
        <div className="auth-side-content">
          <h2>BaseCamp</h2>
          <p>
            Student registration. Staff and faculty accounts are set up by invitation instead.
          </p>
        </div>
        <div className="auth-side-mark">
          <Brand variant="white" height={40} />
        </div>
      </div>
      <div className="auth-content">
        <div className="auth-card" style={{ maxWidth: 480 }}>
          <div className="auth-header">
            {!wideEnoughForPanel && (
              <div className="auth-logo"><Brand height={34} /></div>
            )}
            <h1 className="auth-title">
              {step === 'form' ? 'Create your account' : step === 'confirm' ? 'Check your email' : 'Enroll multi-factor authentication'}
            </h1>
            <p className="auth-subtitle">
              {step === 'form' && 'Students only — staff accounts come by invitation.'}
              {step === 'confirm' && `Enter the 6-digit code sent to ${email}.`}
              {step === 'mfa' && 'Mandatory, cannot be skipped.'}
            </p>
          </div>

          {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}
          {step === 'form' && catalogError && (
            <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>{catalogError}</div>
          )}

          {step === 'form' && (
            <form onSubmit={handleSubmit} className="auth-form">
              <div className="form-group">
                <label className="form-label">Full name</label>
                <input className="form-input" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input type="email" className="form-input" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input type="password" className="form-input" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="grid-cols-2">
                <div className="form-group">
                  <label className="form-label">Department</label>
                  <select className="form-input" required value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                    <option value="">Select...</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Batch</label>
                  <select className="form-input" value={classId} onChange={(e) => setClassId(e.target.value)} disabled={!departmentId}>
                    <option value="">Select...</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Registration number</label>
                <input className="form-input" required value={regNo} onChange={(e) => setRegNo(e.target.value)} />
              </div>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Creating...' : 'Register'} <ArrowRight size={18} />
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

          {step === 'form' && (
            <div className="auth-footer">
              Already have an account? <button type="button" className="auth-link" onClick={onSwitchToLogin}>Sign in</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
