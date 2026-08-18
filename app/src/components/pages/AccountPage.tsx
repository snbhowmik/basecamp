import { useEffect, useState, type FormEvent } from 'react';
import { ShieldCheck, KeyRound, RefreshCw, Check } from 'lucide-react';
import type { UserContext } from '../../lib/context';
import {
  listMfaFactors,
  beginMfaReenroll,
  confirmMfaReenroll,
  cancelMfaEnroll,
  updateProfile,
  changePassword,
  getMemberDetails,
  type MfaFactorSummary,
  type MemberDetails,
} from '../../lib/account';

export default function AccountPage({ ctx, onProfileChanged }: { ctx: UserContext; onProfileChanged: () => void }) {
  const [factors, setFactors] = useState<MfaFactorSummary[]>([]);
  const [member, setMember] = useState<MemberDetails | null>(null);
  const [loading, setLoading] = useState(true);

  const [fullName, setFullName] = useState(ctx.profile.full_name);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [password, setPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [passwordErr, setPasswordErr] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [reenroll, setReenroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [mfaErr, setMfaErr] = useState('');
  const [mfaMsg, setMfaMsg] = useState('');
  const [busyMfa, setBusyMfa] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [f, s] = await Promise.all([
          listMfaFactors(),
          getMemberDetails(ctx.profile.id).catch(() => null),
        ]);
        setFactors(f);
        setMember(s);
      } finally {
        setLoading(false);
      }
    })();
  }, [ctx.profile.id]);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileErr('');
    setProfileMsg('');
    try {
      await updateProfile({ full_name: fullName.trim() });
      setProfileMsg('Profile updated.');
      onProfileChanged();
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : 'Could not update profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setPasswordErr('Password must be at least 8 characters.');
      return;
    }
    setSavingPassword(true);
    setPasswordErr('');
    setPasswordMsg('');
    try {
      await changePassword(password);
      setPassword('');
      setPasswordMsg('Password changed.');
    } catch (err) {
      setPasswordErr(err instanceof Error ? err.message : 'Could not change password.');
    } finally {
      setSavingPassword(false);
    }
  };

  const startReenroll = async () => {
    setBusyMfa(true);
    setMfaErr('');
    setMfaMsg('');
    try {
      const enrolled = await beginMfaReenroll();
      setReenroll({ id: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret });
    } catch (err) {
      setMfaErr(err instanceof Error ? err.message : 'Could not start re-enrollment.');
    } finally {
      setBusyMfa(false);
    }
  };

  const finishReenroll = async (e: FormEvent) => {
    e.preventDefault();
    if (!reenroll) return;
    setBusyMfa(true);
    setMfaErr('');
    try {
      const oldIds = factors.filter((f) => f.status === 'verified' && f.id !== reenroll.id).map((f) => f.id);
      await confirmMfaReenroll(reenroll.id, totpCode, oldIds);
      setReenroll(null);
      setTotpCode('');
      setMfaMsg('Authenticator replaced. Use the new one from your next sign-in.');
      setFactors(await listMfaFactors());
    } catch (err) {
      setMfaErr(err instanceof Error ? err.message : 'Verification failed — check the code and try again.');
    } finally {
      setBusyMfa(false);
    }
  };

  const abortReenroll = async () => {
    if (!reenroll) return;
    await cancelMfaEnroll(reenroll.id).catch(() => {});
    setReenroll(null);
    setTotpCode('');
    setMfaErr('');
  };

  if (loading) return <div className="loading-spinner" style={{ marginTop: '4rem' }} />;

  const verified = factors.filter((f) => f.status === 'verified');

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">My account</h1>
          <p className="page-subtitle">Your details, password, and authenticator.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="card-header"><h2 className="section-title">Profile</h2></div>
        <div className="card-body">
          <div className="detail-grid" style={{ marginBottom: '1.5rem' }}>
            <div className="detail-row">
              <span className="detail-label">Email</span>
              <span className="detail-value">{ctx.profile.email}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Role</span>
              <span className="detail-value">{ctx.isCaptain ? 'Captain' : ctx.isStaff ? 'Staff' : 'Student'}</span>
            </div>
            {member && (
              <>
                <div className="detail-row">
                  <span className="detail-label">
                    {member.member_type === 'staff' ? 'FET ID' : 'Registration number'}
                  </span>
                  <span className="detail-value">
                    {(member.member_type === 'staff' ? member.fet_id : member.reg_no)
                      ?? <span className="detail-value empty">Not set</span>}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Org unit</span>
                  <span className="detail-value">{member.org_units?.name ?? '—'}</span>
                </div>
                {member.member_type === 'student' && (
                  <>
                    <div className="detail-row">
                      <span className="detail-label">Batch</span>
                      <span className="detail-value">{member.batches?.name ?? <span className="detail-value empty">Not set</span>}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Section</span>
                      <span className="detail-value">{member.sections?.name ?? <span className="detail-value empty">Not set</span>}</span>
                    </div>
                  </>
                )}
              </>
            )}
            <div className="detail-row">
              <span className="detail-label">Tags</span>
              <span className="detail-value">
                {ctx.tagCodes.length ? (
                  <span className="chip-list">
                    {ctx.tagCodes.map((t) => <span key={t} className="chip">{t}</span>)}
                  </span>
                ) : <span className="detail-value empty">None</span>}
              </span>
            </div>
          </div>

          <form onSubmit={saveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 520 }}>
            {profileErr && <div className="alert alert-danger">{profileErr}</div>}
            {profileMsg && <div className="alert alert-success">{profileMsg}</div>}
            <div className="form-group">
              <label className="form-label">Full name</label>
              <input className="form-input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div>
              <button className="btn btn-primary" type="submit" disabled={savingProfile}>
                {savingProfile ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldCheck size={16} /> Authenticator
            </h2>
          </div>
          <div className="card-body">
            {mfaErr && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{mfaErr}</div>}
            {mfaMsg && <div className="alert alert-success" style={{ marginBottom: '1rem' }}>{mfaMsg}</div>}

            {!reenroll ? (
              <>
                <p className="form-hint" style={{ marginBottom: '1rem' }}>
                  {verified.length > 0
                    ? `${verified.length} authenticator${verified.length > 1 ? 's' : ''} enrolled. Replacing it will invalidate the old one once you confirm the new code.`
                    : 'No authenticator enrolled.'}
                </p>
                <button className="btn btn-secondary" onClick={startReenroll} disabled={busyMfa}>
                  <RefreshCw size={15} /> {busyMfa ? 'Preparing...' : 'Replace authenticator'}
                </button>
                <p className="form-hint" style={{ marginTop: '1rem' }}>
                  Locked out entirely and can't sign in? This page can't help — an administrator has to
                  reset it for you.
                </p>
              </>
            ) : (
              <form onSubmit={finishReenroll} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ padding: '0.9rem', background: '#fff', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                    <img src={reenroll.qr} alt="Scan with your authenticator app" width={170} height={170} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Or enter this key manually</label>
                  <code style={{ fontSize: '0.8rem', wordBreak: 'break-all', background: 'var(--bg-color)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.6rem 0.8rem', display: 'block' }}>
                    {reenroll.secret}
                  </code>
                </div>
                <div className="form-group">
                  <label className="form-label">6-digit code from the new app</label>
                  <input
                    className="form-input"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoFocus
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    style={{ textAlign: 'center', fontSize: '1.3rem', letterSpacing: '0.4rem' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={abortReenroll} disabled={busyMfa}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={busyMfa}>
                    <Check size={15} /> {busyMfa ? 'Verifying...' : 'Confirm new authenticator'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <KeyRound size={16} /> Password
            </h2>
          </div>
          <div className="card-body">
            <form onSubmit={savePassword} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {passwordErr && <div className="alert alert-danger">{passwordErr}</div>}
              {passwordMsg && <div className="alert alert-success">{passwordMsg}</div>}
              <div className="form-group">
                <label className="form-label">New password</label>
                <input
                  type="password"
                  className="form-input"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                />
              </div>
              <div>
                <button className="btn btn-primary" type="submit" disabled={savingPassword}>
                  {savingPassword ? 'Updating...' : 'Change password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
