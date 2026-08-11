import { useEffect, useState, type FormEvent } from 'react';
import { UserPlus, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  listPriorityLevels,
  listTags,
  listDepartments,
  listClasses,
  listMyInvites,
  createInvite,
  revokeInvite,
} from '../../lib/invites';
import type { PriorityLevel, Tag, Department, Class, PendingAssignment } from '../../types';

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

  const [email, setEmail] = useState('');
  const [levelId, setLevelId] = useState('');
  const [selectedTagCodes, setSelectedTagCodes] = useState<string[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [classId, setClassId] = useState('');
  const [regNo, setRegNo] = useState('');
  const [year, setYear] = useState('');

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
    try {
      await createInvite({
        email,
        levelId,
        tagCodes: selectedTagCodes,
        departmentId: departmentId || null,
        classId: classId || null,
        regNo: regNo.trim() || null,
        year: year ? Number(year) : null,
      });
      setSuccess(`Invited ${email}. Their level/tags apply automatically the moment they sign up.`);
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
                  <th>Sent</th>
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
                      {new Date(inv.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!inv.consumed_at && (
                        <button className="btn-icon danger" title="Revoke" onClick={() => handleRevoke(inv.id)}>
                          <X size={16} />
                        </button>
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
