import { errorMessage } from '../../lib/errors';
import { useEffect, useState } from 'react';
import { Plus, Trash2, ShieldOff, ShieldCheck } from 'lucide-react';
import Modal from '../ui/Modal';
import ConfirmDestructive from '../ui/ConfirmDestructive';
import {
  listRoleAssignments, assignRole, setUserTags, setAccountActive,
  type RoleAssignmentRow,
} from '../../lib/people';
import { adminDelete } from '../../lib/admin';
import { listPriorityLevels, listTags, listOrgUnits } from '../../lib/invites';
import type { AccountRow } from '../../lib/org';
import type { PriorityLevel, Tag, OrgUnit } from '../../types';

// Editing a person, in the two halves they actually divide into.
//
// Role assignments are authority: which level, scoped to which org unit, in
// which capacity. A person holds several — an academic mentor who also runs a
// club is two assignments, not one field — so this is a list you add to and
// remove from, not a dropdown you overwrite.
//
// Tags are membership: which department or school they belong to. The 'admin'
// tag never appears here in either direction; it is the captaincy, and the
// database refuses to grant or revoke it through this path.

export default function PersonEditor({ account, onClose, onChanged }: {
  account: AccountRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [roles, setRoles] = useState<RoleAssignmentRow[]>([]);
  const [levels, setLevels] = useState<PriorityLevel[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [newLevel, setNewLevel] = useState('');
  const [newOrgUnit, setNewOrgUnit] = useState('');
  const [newKind, setNewKind] = useState('academic');
  const [removing, setRemoving] = useState<RoleAssignmentRow | null>(null);
  const [suspending, setSuspending] = useState(false);

  const reload = async () => {
    const [r, l, t, o] = await Promise.all([
      listRoleAssignments(account.id), listPriorityLevels(), listTags(), listOrgUnits(),
    ]);
    setRoles(r);
    setLevels(l.filter((x) => !x.is_reserved));
    setTags(t.filter((x) => x.code !== 'admin'));
    setOrgUnits(o);
    setSelectedTags(account.tags.filter((c) => c !== 'admin'));
  };

  useEffect(() => {
    reload().catch((e) => setError(errorMessage(e, 'Could not load this account.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setError(''); setMsg('');
    try {
      await fn();
      await reload();
      onChanged();
      setMsg(ok);
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };

  const addRole = () => {
    if (!newLevel) { setError('Pick a level.'); return; }
    run(async () => {
      await assignRole({
        userId: account.id,
        levelId: newLevel,
        orgUnitId: newOrgUnit || null,
        roleKind: newKind,
        isPrimary: roles.length === 0,
      });
      setNewLevel(''); setNewOrgUnit('');
    }, 'Role added.');
  };

  const toggleTag = (code: string) =>
    setSelectedTags((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));

  return (
    <Modal isOpen onClose={onClose} title={account.full_name} maxWidth="640px"
      footer={<button className="btn btn-secondary" onClick={onClose} disabled={busy}>Done</button>}>

      {removing && (
        <ConfirmDestructive
          title="Remove role"
          recordName={removing.priority_levels?.name ?? 'role'}
          description={`Removing ${account.full_name}'s ${removing.priority_levels?.name ?? 'role'} assignment.`}
          onCancel={() => setRemoving(null)}
          onConfirmed={async () => {
            await adminDelete('role_assignments', removing.id);
            setRemoving(null);
            await reload();
            onChanged();
          }}
        />
      )}

      {suspending && (
        <ConfirmDestructive
          title="Suspend account"
          recordName={account.full_name}
          description={`${account.full_name} will not be able to sign in. Their tickets and history stay intact.`}
          onCancel={() => setSuspending(false)}
          onConfirmed={async () => {
            await setAccountActive(account.id, false);
            setSuspending(false);
            await reload();
            onChanged();
          }}
        />
      )}

      {error && <div className="alert alert-danger">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="detail-row">
        <span className="detail-label">Email</span>
        <span className="detail-value cell-mono">{account.email}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Status</span>
        <span className="detail-value">
          {account.is_active
            ? <span className="status-badge status-success">Active</span>
            : <span className="status-badge status-danger">Suspended</span>}
        </span>
      </div>

      <h3 className="section-title" style={{ marginTop: '1.25rem' }}>Roles</h3>
      <p className="form-hint">
        Authority comes from these. Someone can hold more than one — an academic role and a club
        role are different jobs with different scope.
      </p>
      {roles.length === 0 ? (
        <p className="detail-value empty">No roles assigned — this account has no authority anywhere.</p>
      ) : (
        <div className="table-container" style={{ marginBottom: '1rem' }}>
          <table>
            <thead><tr><th>Level</th><th>Scope</th><th>Kind</th><th></th><th style={{ textAlign: 'right' }}></th></tr></thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id}>
                  <td className="cell-strong">{r.priority_levels?.name ?? '—'}</td>
                  <td>{r.org_units?.name ?? <span className="detail-value empty">Instance-wide</span>}</td>
                  <td>{r.role_kind}</td>
                  <td>{r.is_primary && <span className="status-badge status-progress">Primary</span>}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn-icon" title="Remove role" onClick={() => setRemoving(r)}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid-cols-2">
        <div className="form-group">
          <label className="form-label">Level</label>
          <select className="form-input" value={newLevel} onChange={(e) => setNewLevel(e.target.value)}>
            <option value="">Select...</option>
            {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Scope (optional)</label>
          <select className="form-input" value={newOrgUnit} onChange={(e) => setNewOrgUnit(e.target.value)}>
            <option value="">Instance-wide</option>
            {orgUnits.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid-cols-2">
        <div className="form-group">
          <label className="form-label">Kind</label>
          <select className="form-input" value={newKind} onChange={(e) => setNewKind(e.target.value)}>
            <option value="academic">Academic</option>
            <option value="club">Club</option>
            <option value="event">Event</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button className="btn btn-primary" onClick={addRole} disabled={busy}>
            <Plus size={15} /> Add role
          </button>
        </div>
      </div>

      <h3 className="section-title" style={{ marginTop: '1.25rem' }}>Tags</h3>
      <p className="form-hint">
        Membership — which school, department or section this person belongs to. The captain tag is
        not editable here.
      </p>
      <div className="chip-list" style={{ marginBottom: '0.75rem' }}>
        {tags.map((t) => (
          <button
            type="button"
            key={t.id}
            className={`chip ${selectedTags.includes(t.code) ? 'chip-active' : ''}`}
            onClick={() => toggleTag(t.code)}
          >
            {t.code}
          </button>
        ))}
      </div>
      <button className="btn btn-primary" disabled={busy}
        onClick={() => run(() => setUserTags(account.id, selectedTags), 'Tags updated.')}>
        Save tags
      </button>

      <h3 className="section-title" style={{ marginTop: '1.5rem' }}>Account</h3>
      {account.is_active ? (
        <button className="btn btn-danger" disabled={busy} onClick={() => setSuspending(true)}>
          <ShieldOff size={15} /> Suspend account
        </button>
      ) : (
        <button className="btn btn-secondary" disabled={busy}
          onClick={() => run(() => setAccountActive(account.id, true), 'Account restored.')}>
          <ShieldCheck size={15} /> Restore account
        </button>
      )}
    </Modal>
  );
}
