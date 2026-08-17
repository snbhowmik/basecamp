import { useEffect, useState, type FormEvent } from 'react';
import { UserPlus, X, Copy, Check as CheckIcon, Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  listPriorityLevels,
  listTags,
  listDepartments,
  listClasses,
  listMyInvites,
  createInvite,
  revokeInvite,
  resendInviteEmail,
  inviteLink,
} from '../../lib/invites';
import type { PriorityLevel, Tag, Department, Class, PendingAssignment } from '../../types';

// Delivery is asynchronous — the mailer worker (services/mailer) polls every
// ~20s. So "not sent yet" is the normal state for the first minute and is
// deliberately not styled as a failure; only a recorded error is.
function deliveryLabel(inv: PendingAssignment): string {
  if (inv.invite_email_sent_at) {
    return `Emailed ${new Date(inv.invite_email_sent_at).toLocaleString()}`;
  }
  if (inv.invite_email_error) {
    return inv.invite_email_attempts >= 5
      ? 'Delivery failed — send the link manually'
      : `Retrying (attempt ${inv.invite_email_attempts} of 5)`;
  }
  return 'Queued';
}

// Who can invite whom is enforced server-side by can_invite() (0004) — rank
// comparison plus department-tag membership, not a hardcoded role list. This
// component just calls my_rank() to filter the level dropdown to a sane
// subset for UX; the real gate is the RLS policy on the insert itself.
export default function InvitePanel() {
  const [levels, setLevels] = useState<PriorityLevel[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [invites, setInvites] = useState<PendingAssignment[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [levelId, setLevelId] = useState('');
  const [selectedTagCodes, setSelectedTagCodes] = useState<string[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [classId, setClassId] = useState('');
  const [regNo, setRegNo] = useState('');
  const [year, setYear] = useState('');
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!departmentId) {
      setClasses([]);
      setClassId('');
      return;
    }
    listClasses(departmentId).then(setClasses).catch(() => setClasses([]));
  }, [departmentId]);

  const load = async () => {
    setLoading(true);
    try {
      const [lv, tg, dp, inv, rank] = await Promise.all([
        listPriorityLevels(),
        listTags(),
        listDepartments(),
        listMyInvites(),
        supabase.rpc('my_rank'),
      ]);
      setLevels(lv);
      setTags(tg.filter((t) => t.code !== 'admin'));
      setDepartments(dp);
      setInvites(inv);
      setMyRank(typeof rank.data === 'number' ? rank.data : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  };

  // Levels a lower rank number than mine is *higher* authority — invitable
  // levels are strictly lower authority than the inviter (higher rank number).
  const invitableLevels = myRank === null ? levels : levels.filter((l) => l.rank > myRank);

  const toggleTag = (code: string) => {
    setSelectedTagCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const resetForm = () => {
    setEmail('');
    setLevelId('');
    setSelectedTagCodes([]);
    setDepartmentId('');
    setClassId('');
    setRegNo('');
    setYear('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!levelId) {
      setError('Choose a level.');
      return;
    }
    setSubmitting(true);
    setLastInviteLink(null);
    setLinkCopied(false);
    try {
      const created = await createInvite({
        email,
        levelId,
        tagCodes: selectedTagCodes,
        departmentId: departmentId || null,
        classId: classId || null,
        regNo: regNo.trim() || null,
        year: year ? Number(year) : null,
      });
      // The mailer worker polls every ~20s, so the email is queued rather
      // than sent by the time this returns. The link is still shown as a
      // fallback for when delivery fails or the invitee never gets it.
      setSuccess(`Invited ${email}. An invite email is queued — it usually arrives within a minute.`);
      setLastInviteLink(inviteLink(created.invite_token));
      resetForm();
      const inv = await listMyInvites();
      setInvites(inv);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't create the invite — you may not have permission to invite this level or department.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeInvite(id);
      setInvites(invites.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke.');
    }
  };

  const handleResend = async (id: string) => {
    setResending(id);
    setError('');
    try {
      await resendInviteEmail(id);
      setSuccess('Queued for resend — it usually arrives within a minute.');
      setInvites(await listMyInvites());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue the resend.');
    } finally {
      setResending(null);
    }
  };

  if (loading) {
    return <div className="loading-spinner" style={{ margin: '3rem auto' }} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div className="card" style={{ padding: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <UserPlus size={18} /> Invite someone
        </h2>
        <p className="form-hint" style={{ marginBottom: '1.25rem' }}>
          No account is created yet — they get the level and tags below automatically the moment they sign up with this email.
        </p>

        {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}
        {success && <div className="alert alert-success" style={{ marginBottom: '1rem' }}>{success}</div>}
        {lastInviteLink && (
          <div className="repeatable-row" style={{ marginBottom: '1rem' }}>
            <input className="form-input" readOnly value={lastInviteLink} onFocus={(e) => e.target.select()} />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                navigator.clipboard.writeText(lastInviteLink);
                setLinkCopied(true);
              }}
            >
              {linkCopied ? <CheckIcon size={16} /> : <Copy size={16} />}
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="grid-cols-2">
            <div className="form-group">
              <label className="form-label">Email</label>
              <input type="email" className="form-input" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Level</label>
              <select className="form-input" required value={levelId} onChange={(e) => setLevelId(e.target.value)}>
                <option value="">Select a level...</option>
                {invitableLevels.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Tags (role identity)</label>
            <div className="chip-list">
              {tags.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className="chip"
                  style={{
                    cursor: 'pointer',
                    background: selectedTagCodes.includes(t.code) ? 'var(--primary-light)' : undefined,
                    borderColor: selectedTagCodes.includes(t.code) ? 'var(--primary)' : undefined,
                    color: selectedTagCodes.includes(t.code) ? 'var(--primary)' : undefined,
                  }}
                  onClick={() => toggleTag(t.code)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <span className="form-hint">Leave empty for a student invite (department below is still required for one).</span>
          </div>

          <div className="grid-cols-2">
            <div className="form-group">
              <label className="form-label">Department (optional)</label>
              <select className="form-input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">No department scoping</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Class (optional)</label>
              <select className="form-input" value={classId} onChange={(e) => setClassId(e.target.value)} disabled={!departmentId}>
                <option value="">No class scoping</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {selectedTagCodes.length === 0 && departmentId && (
            <div className="grid-cols-2">
              <div className="form-group">
                <label className="form-label">Registration number (optional)</label>
                <input className="form-input" value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="Leave blank if unknown — they can complete it later" />
              </div>
              <div className="form-group">
                <label className="form-label">Year (optional)</label>
                <input type="number" min={1} max={6} className="form-input" value={year} onChange={(e) => setYear(e.target.value)} />
              </div>
            </div>
          )}

          <div>
            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Inviting...' : 'Send invite'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Invites you've sent</h3>
        </div>
        <div className="table-container">
          {invites.length === 0 ? (
            <div className="empty-state">No invites yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Delivery</th>
                  <th>Created</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.email}</td>
                    <td>
                      <span className={`status-badge ${inv.consumed_at ? 'status-success' : 'status-progress'}`}>
                        {inv.consumed_at ? 'Joined' : 'Pending'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      {deliveryLabel(inv)}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      {new Date(inv.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!inv.consumed_at && (
                        <>
                          <button
                            className="btn-icon"
                            title="Resend invite email"
                            disabled={resending === inv.id}
                            onClick={() => handleResend(inv.id)}
                          >
                            <Send size={16} />
                          </button>
                          <button className="btn-icon danger" title="Revoke" onClick={() => handleRevoke(inv.id)}>
                            <X size={16} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
