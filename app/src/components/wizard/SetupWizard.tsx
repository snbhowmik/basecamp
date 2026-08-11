import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, X, ShieldCheck, Check, MailCheck } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import {
  createCaptainAccount,
  enrollTotp,
  verifyTotp,
  addAllowedDomains,
  completeOrgSetup,
  type DraftDepartment,
  type DraftPriorityLevel,
  type DraftTag,
} from '../../lib/wizard';

// A starting suggestion only, freely edited/removed below — priority levels
// here are ranks of authority, not fixed named roles (a Dean of IST and a
// Dean of TRP are different accounts at the same level, distinguished by
// tags/department, not by separate levels — see README.md).
const DEFAULT_LEVELS: DraftPriorityLevel[] = [
  { name: 'Dean / Principal' },
  { name: 'Head of Department' },
  { name: 'Coordinator' },
  { name: 'Mentor / Class Advisor' },
  { name: 'Student' },
];

type Step = 1 | 2 | 3 | 4;

export default function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Step 1 — captain account
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captainUser, setCaptainUser] = useState<User | null>(null);
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

  // Step 4 — org
  const [levels, setLevels] = useState<DraftPriorityLevel[]>(DEFAULT_LEVELS);
  const [levelInput, setLevelInput] = useState('');
  const [departments, setDepartments] = useState<DraftDepartment[]>([]);
  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [extraTags, setExtraTags] = useState<DraftTag[]>([]);
  const [tagCode, setTagCode] = useState('');
  const [tagLabel, setTagLabel] = useState('');
  const [firstCategoryName, setFirstCategoryName] = useState('OD Request');

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
  const resumeFromSession = async (user: User) => {
    setCaptainUser(user);
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

  const handleDomainsSubmit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await addAllowedDomains(domains);
      setStep(4);
    });
  };

  const addLevel = () => {
    if (levelInput.trim()) {
      setLevels([...levels, { name: levelInput.trim() }]);
      setLevelInput('');
    }
  };

  const addDepartment = () => {
    if (deptName.trim() && deptCode.trim()) {
      setDepartments([...departments, { name: deptName.trim(), code: deptCode.trim().toLowerCase() }]);
      setDeptName('');
      setDeptCode('');
    }
  };

  const addTag = () => {
    if (tagCode.trim() && tagLabel.trim()) {
      setExtraTags([...extraTags, { code: tagCode.trim(), label: tagLabel.trim() }]);
      setTagCode('');
      setTagLabel('');
    }
  };

  const handleOrgSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!captainUser) {
      setError('Captain account was lost — please restart the wizard.');
      return;
    }
    if (levels.length === 0) {
      setError('Add at least one priority level.');
      return;
    }
    run(async () => {
      await completeOrgSetup({
        captainUserId: captainUser.id,
        levels,
        departments,
        extraTags,
        firstCategoryName: firstCategoryName.trim() || 'OD Request',
      });
      onComplete();
    });
  };

  return (
    <div className="wizard-wrapper">
      <div className="wizard-card">
        <div className="wizard-steps">
          {[1, 2, 3, 4].map((n) => (
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
                <p className="page-subtitle">Step 1 of 4 — the captain is the only account created outside the normal sign-up flow. Every other account (Dean, HOD, Mentor, Student, ...) is created by hand afterward, inside the app.</p>
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
                <p className="page-subtitle">Step 2 of 4 — scan this QR code with an authenticator app, then enter the 6-digit code.</p>
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
                <p className="page-subtitle">Step 3 of 4 — only these email domains will be able to register. {email.split('@')[1]} is already allowed (your captain account).</p>
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
                {submitting ? 'Saving...' : 'Continue'}
              </button>
            </div>
          </form>
        )}

        {step === 4 && (
          <form onSubmit={handleOrgSubmit}>
            <div className="wizard-body">
              <div>
                <h1 className="page-title">Configure the organisation</h1>
                <p className="page-subtitle">Step 4 of 4 — priority levels, departments, tags, and the first request category.</p>
              </div>

              <div className="form-group">
                <label className="form-label">Priority levels (top to bottom)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {levels.map((l, i) => (
                    <div key={i} className="card" style={{ padding: '0.5rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{i + 1}. {l.name}</span>
                      <button type="button" className="close-btn" onClick={() => setLevels(levels.filter((_, idx) => idx !== i))}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="repeatable-row">
                  <input
                    className="form-input"
                    value={levelInput}
                    onChange={(e) => setLevelInput(e.target.value)}
                    placeholder="e.g. Club Coordinator"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLevel(); } }}
                  />
                  <button type="button" className="btn btn-secondary" onClick={addLevel}><Plus size={16} /></button>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Departments</label>
                <div className="chip-list">
                  {departments.map((d) => (
                    <span key={d.code} className="chip">
                      {d.name} ({d.code})
                      <button type="button" onClick={() => setDepartments(departments.filter((x) => x.code !== d.code))}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="grid-cols-2">
                  <input className="form-input" value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="Department name" />
                  <div className="repeatable-row">
                    <input className="form-input" value={deptCode} onChange={(e) => setDeptCode(e.target.value)} placeholder="code (e.g. cs)" />
                    <button type="button" className="btn btn-secondary" onClick={addDepartment}><Plus size={16} /></button>
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Additional tags (optional)</label>
                <div className="chip-list">
                  {extraTags.map((t) => (
                    <span key={t.code} className="chip">
                      {t.label} ({t.code})
                      <button type="button" onClick={() => setExtraTags(extraTags.filter((x) => x.code !== t.code))}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="grid-cols-2">
                  <input className="form-input" value={tagLabel} onChange={(e) => setTagLabel(e.target.value)} placeholder="Label (e.g. Club Coordinator)" />
                  <div className="repeatable-row">
                    <input className="form-input" value={tagCode} onChange={(e) => setTagCode(e.target.value)} placeholder="code (e.g. club_coordinator)" />
                    <button type="button" className="btn btn-secondary" onClick={addTag}><Plus size={16} /></button>
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">First request category</label>
                <input className="form-input" value={firstCategoryName} onChange={(e) => setFirstCategoryName(e.target.value)} />
                <span className="form-hint">Created as an approval-mode category. More categories, custom fields, departments, and accounts are all created by hand afterward, signed in as captain — nothing else is seeded.</span>
              </div>
            </div>
            <div className="wizard-footer">
              <span />
              <button className="btn btn-primary" type="submit" disabled={submitting}>
                {submitting ? 'Finishing setup...' : 'Finish Setup'}
                <Check size={16} />
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
