import { errorMessage } from '../../lib/errors';
import { useEffect, useState, type FormEvent } from 'react';
import { UserPlus, X, Copy, Check as CheckIcon, Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  listPriorityLevels,
  listTags,
  listOrgUnits,
  listBatches,
  listSections,
  listMyInvites,
  createInvite,
  revokeInvite,
  resendInviteEmail,
  inviteLink,
} from '../../lib/invites';
import type {
  PriorityLevel, Tag, OrgUnit, Batch, Section, MemberType, RoleKind, PendingAssignment,
} from '../../types';

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

// Who can invite whom is enforced server-side by can_invite() — rank
// comparison plus org-unit scoping, not a hardcoded role list. This component
// just calls my_best_rank() to filter the level dropdown to a sane subset for
// UX; the real gate is the RLS policy on the insert itself.
export default function InvitePanel() {
  const [levels, setLevels] = useState<PriorityLevel[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
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
  const [memberType, setMemberType] = useState<MemberType>('student');
  const [roleKind, setRoleKind] = useState<RoleKind>('academic');
  const [orgUnitId, setOrgUnitId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [regNo, setRegNo] = useState('');
  const [fetId, setFetId] = useState('');
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!orgUnitId) {
      setBatches([]);
      setBatchId('');
      return;
    }
    listBatches(orgUnitId).then(setBatches).catch(() => setBatches([]));
  }, [orgUnitId]);

  useEffect(() => {
    if (!batchId) {
      setSections([]);
      setSectionId('');
      return;
    }
    listSections(batchId).then(setSections).catch(() => setSections([]));
  }, [batchId]);

  const load = async () => {
    setLoading(true);
    try {
      const [lv, tg, dp, inv, rank] = await Promise.all([
        listPriorityLevels(),
        listTags(),
        listOrgUnits(),
        listMyInvites(),
        supabase.rpc('my_best_rank'),
      ]);
      setLevels(lv);
      setTags(tg.filter((t) => t.code !== 'admin'));
      setOrgUnits(dp);
      setInvites(inv);
      setMyRank(typeof rank.data === 'number' ? rank.data : null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load.'));
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
    setMemberType('student');
    setRoleKind('academic');
    setOrgUnitId('');
    setBatchId('');
    setSectionId('');
    setRegNo('');
    setFetId('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!levelId) {
      setError('Choose a level.');
      return;
    }
    // member_profiles enforces this pairing with a check constraint, so a
    // mismatched invite would not fail here — it would fail at signup, on the
    // invitee. Catch it while the inviter is still looking at the form.
    if (memberType === 'student' && !regNo.trim()) {
      setError('A student invite needs a registration number.');
      return;
    }
    if (memberType === 'staff' && !fetId.trim()) {
      setError('A staff invite needs a FET ID.');
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
        memberType,
        roleKind,
        orgUnitId: orgUnitId || null,
        batchId: batchId || null,
        sectionId: sectionId || null,
        regNo: memberType === 'student' ? regNo.trim() : null,
        fetId: memberType === 'staff' ? fetId.trim() : null,
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
      setError(errorMessage(err, 'Failed to revoke.'));
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
      setError(errorMessage(err, 'Failed to queue the resend.'));
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
            <span className="form-hint">Tags scope authority; the member type below decides what identifier this account needs.</span>
          </div>

          <div className="grid-cols-2">
            <div className="form-group">
              <label className="form-label">Member type</label>
              <select className="form-input" value={memberType} onChange={(e) => setMemberType(e.target.value as MemberType)}>
                <option value="student">Student</option>
                <option value="staff">Staff</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Role kind</label>
              <select className="form-input" value={roleKind} onChange={(e) => setRoleKind(e.target.value as RoleKind)}>
                <option value="academic">Academic</option>
                <option value="club">Club</option>
                <option value="event">Event</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          <div className="grid-cols-2">
            <div className="form-group">
              <label className="form-label">Org unit (optional)</label>
              <select className="form-input" value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)}>
                <option value="">No org scoping</option>
                {orgUnits.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Batch (optional)</label>
              <select className="form-input" value={batchId} onChange={(e) => setBatchId(e.target.value)} disabled={!orgUnitId}>
                <option value="">No batch scoping</option>
                {batches.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid-cols-2">
            <div className="form-group">
              <label className="form-label">Section (optional)</label>
              <select className="form-input" value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!batchId}>
                <option value="">No section scoping</option>
                {sections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            {memberType === 'student' ? (
              <div className="form-group">
                <label className="form-label">Registration number</label>
                <input className="form-input" required value={regNo} onChange={(e) => setRegNo(e.target.value)} />
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label">FET ID</label>
                <input className="form-input" required value={fetId} onChange={(e) => setFetId(e.target.value)} />
              </div>
            )}
          </div>

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
