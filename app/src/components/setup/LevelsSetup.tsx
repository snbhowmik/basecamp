import { useEffect, useState, type FormEvent } from 'react';
import { Plus, X, ArrowUp, ArrowDown, Check, Lock, Pencil, Trash2 } from 'lucide-react';
import {
  listLevels, completeLevelSetup, appendLevel, insertLevelAfter,
  renameLevel, setLevelTag, type DraftLevel,
} from '../../lib/levels';
import { adminDelete } from '../../lib/admin';
import ConfirmDestructive from '../ui/ConfirmDestructive';
import type { PriorityLevel, Tag } from '../../types';
import { listTags } from '../../lib/invites';

// The authority ladder. Lower rank number = higher authority; the lowest level
// is the base one that students sit at.
//
// The captain does NOT type their own rung. setup_levels() creates it
// automatically above everything here, so the list below starts at whatever
// the captain calls their highest *named* level (Dean, Principal, Director).
// Requiring them to type "Admin" means it can be forgotten, misspelled, or
// ordered wrongly, and the top of the ladder should not depend on that.
//
// Nothing here is seeded. v1 shipped a prefilled Dean/HOD/Coordinator/Mentor/
// Student list in the signup wizard, which is fixture data by another name and
// wrong for any org that is not this one.

const emptyDraft = (): DraftLevel => ({ name: '', tagCode: '', tagLabel: '' });

export default function LevelsSetup({ mode, onDone }: { mode: 'setup' | 'manage'; onDone: () => void }) {
  const [drafts, setDrafts] = useState<DraftLevel[]>([emptyDraft()]);
  const [existing, setExisting] = useState<PriorityLevel[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [appendDraft, setAppendDraft] = useState<DraftLevel>(emptyDraft());
  // Which level a mid-ladder insert is anchored under, if any.
  const [insertAfter, setInsertAfter] = useState<string | null>(null);
  const [insertDraft, setInsertDraft] = useState<DraftLevel>(emptyDraft());
  // Inline edit of one row: name and tag are both editable after creation;
  // rank is not, because existing tickets resolve authority through it.
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTag, setEditTag] = useState('');
  const [deleting, setDeleting] = useState<PriorityLevel | null>(null);

  useEffect(() => {
    if (mode !== 'manage') return;
    Promise.all([listLevels(), listTags()])
      .then(([l, t]) => { setExisting(l); setTags(t); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load levels.'));
  }, [mode]);

  const update = (i: number, patch: Partial<DraftLevel>) =>
    setDrafts(drafts.map((d, n) => (n === i ? { ...d, ...patch } : d)));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= drafts.length) return;
    const next = [...drafts];
    [next[i], next[j]] = [next[j], next[i]];
    setDrafts(next);
  };

  const submitSetup = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const filled = drafts.filter((d) => d.name.trim());
    if (filled.length === 0) {
      setError('Add at least one level.');
      return;
    }
    const codes = filled.map((d) => d.tagCode.trim().toLowerCase()).filter(Boolean);
    if (new Set(codes).size !== codes.length) {
      setError('Two levels share a tag code. Each tag identifies one level.');
      return;
    }
    if (codes.includes('admin')) {
      setError("'admin' is reserved for the captain — pick another tag code.");
      return;
    }
    setBusy(true);
    completeLevelSetup(filled)
      .then(onDone)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not create levels.'))
      .finally(() => setBusy(false));
  };

  const submitAppend = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!appendDraft.name.trim()) return;
    setBusy(true);
    appendLevel(appendDraft)
      .then(async () => {
        setAppendDraft(emptyDraft());
        setExisting(await listLevels());
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not add the level.'))
      .finally(() => setBusy(false));
  };

  const submitInsert = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!insertAfter || !insertDraft.name.trim()) return;
    setBusy(true);
    insertLevelAfter(insertAfter, insertDraft)
      .then(async () => {
        setInsertAfter(null);
        setInsertDraft(emptyDraft());
        setExisting(await listLevels());
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not insert the level.'))
      .finally(() => setBusy(false));
  };

  const startEdit = (l: PriorityLevel) => {
    setEditing(l.id);
    setEditName(l.name);
    setEditTag(tags.find((t) => t.id === l.tag_id)?.code ?? '');
  };

  const saveEdit = async (l: PriorityLevel) => {
    setBusy(true);
    setError('');
    try {
      if (editName.trim() && editName.trim() !== l.name) await renameLevel(l.id, editName);
      const currentCode = tags.find((t) => t.id === l.tag_id)?.code ?? '';
      if (editTag.trim().toLowerCase() !== currentCode) await setLevelTag(l.id, editTag, editTag);
      setEditing(null);
      const [l2, t2] = await Promise.all([listLevels(), listTags()]);
      setExisting(l2); setTags(t2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the level.');
    } finally {
      setBusy(false);
    }
  };

  const tagLabelFor = (id: string | null) =>
    id ? tags.find((t) => t.id === id)?.code ?? '—' : null;

  // ---------------- manage ----------------
  if (mode === 'manage') {
    return (
      <>
        {error && <div className="alert alert-danger" style={{ marginBottom: '1.25rem' }}>{error}</div>}

        {deleting && (
          <ConfirmDestructive
            title="Delete level"
            recordName={deleting.name}
            description={`Removing the "${deleting.name}" level.`}
            onCancel={() => setDeleting(null)}
            onConfirmed={async () => {
              await adminDelete('priority_levels', deleting.id);
              setDeleting(null);
              const [l2, t2] = await Promise.all([listLevels(), listTags()]);
              setExisting(l2); setTags(t2);
            }}
          />
        )}

        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <div className="card-header">
            <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Lock size={16} /> Authority ladder
            </h2>
          </div>
          <div className="card-body">
            <p className="form-hint" style={{ marginBottom: '1rem' }}>
              Existing levels never move. Ranks are spaced ten apart so a new level can be slotted
              between two others by taking the gap — tickets in flight resolve authority through a
              level's rank, so renumbering would change what they mean.
            </p>
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>Rank</th><th>Level</th><th>Tag</th><th></th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                </thead>
                <tbody>
                  {existing.map((l) => (
                    <tr key={l.id}>
                      <td className="cell-mono">{l.rank}</td>
                      <td>
                        {editing === l.id
                          ? <input className="form-input" value={editName} onChange={(e) => setEditName(e.target.value)} />
                          : <span className="cell-strong">{l.name}</span>}
                      </td>
                      <td>
                        {editing === l.id ? (
                          <input className="form-input" value={editTag} placeholder="no tag"
                            onChange={(e) => setEditTag(e.target.value)} />
                        ) : tagLabelFor(l.tag_id)
                          ? <span className="chip">{tagLabelFor(l.tag_id)}</span>
                          : <span className="detail-value empty">No tag yet</span>}
                      </td>
                      <td>
                        {l.is_reserved && <span className="status-badge status-progress">Captain</span>}
                        {l.is_base && <span className="status-badge status-neutral">Base</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                          {editing === l.id ? (
                            <>
                              <button type="button" className="btn btn-primary" disabled={busy}
                                onClick={() => saveEdit(l)}>Save</button>
                              <button type="button" className="btn btn-secondary"
                                onClick={() => setEditing(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              {!l.is_reserved && (
                                <button type="button" className="btn btn-secondary" title="Edit"
                                  onClick={() => startEdit(l)}><Pencil size={14} /></button>
                              )}
                              {!l.is_base && (
                                <button type="button" className="btn btn-secondary"
                                  onClick={() => { setInsertAfter(l.id); setInsertDraft(emptyDraft()); }}>
                                  Insert below
                                </button>
                              )}
                              {!l.is_reserved && (
                                <button type="button" className="btn btn-secondary" title="Delete"
                                  onClick={() => setDeleting(l)}><Trash2 size={14} /></button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {insertAfter && (
          <div className="card" style={{ marginBottom: '1.25rem' }}>
            <div className="card-header">
              <h2 className="section-title">
                Insert below {existing.find((l) => l.id === insertAfter)?.name}
              </h2>
            </div>
            <div className="card-body">
              <form onSubmit={submitInsert} className="grid-cols-2" style={{ alignItems: 'end' }}>
                <div className="form-group">
                  <label className="form-label">Level name</label>
                  <input className="form-input" required value={insertDraft.name}
                    onChange={(e) => setInsertDraft({ ...insertDraft, name: e.target.value })}
                    placeholder="Student Coordinator" />
                </div>
                <div className="form-group">
                  <label className="form-label">Tag code (optional)</label>
                  <div className="repeatable-row">
                    <input className="form-input" value={insertDraft.tagCode}
                      onChange={(e) => setInsertDraft({ ...insertDraft, tagCode: e.target.value })}
                      placeholder="student_coord" />
                    <button className="btn btn-primary" type="submit" disabled={busy}><Plus size={15} /></button>
                    <button className="btn btn-secondary" type="button" onClick={() => setInsertAfter(null)}>
                      <X size={15} />
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-header"><h2 className="section-title">Add a level at the bottom</h2></div>
          <div className="card-body">
            <form onSubmit={submitAppend} className="grid-cols-2" style={{ alignItems: 'end' }}>
              <div className="form-group">
                <label className="form-label">Level name</label>
                <input className="form-input" required value={appendDraft.name}
                  onChange={(e) => setAppendDraft({ ...appendDraft, name: e.target.value })}
                  placeholder="Student Coordinator" />
              </div>
              <div className="form-group">
                <label className="form-label">Tag code (optional)</label>
                <div className="repeatable-row">
                  <input className="form-input" value={appendDraft.tagCode}
                    onChange={(e) => setAppendDraft({ ...appendDraft, tagCode: e.target.value })}
                    placeholder="student_coordinator" />
                  <button className="btn btn-primary" type="submit" disabled={busy}><Plus size={15} /></button>
                </div>
              </div>
            </form>
            <span className="form-hint">
              A new level joins at the bottom of the ladder and becomes the base level.
            </span>
          </div>
        </div>
      </>
    );
  }

  // ---------------- first-run setup ----------------
  return (
    <div className="wizard-wrapper">
      <div className="wizard-card">
        <form onSubmit={submitSetup}>
          <div className="wizard-body">
            <div>
              <h1 className="page-title">Set up your authority levels</h1>
              <p className="page-subtitle">
                List the ranks in your organisation, highest first — start at Dean, or whatever
                your top role is called. Your own captain level is created automatically above all
                of them, so do not add it. A tag identifies the people who hold a level; leave it
                blank now and fill it in later if you would rather.
              </p>
            </div>

            {error && <div className="alert alert-danger">{error}</div>}

            {drafts.map((d, i) => (
              <div className="card" key={i} style={{ padding: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <span className="chip">Rank {i + 1}</span>
                  {i === drafts.length - 1 && drafts.length > 1 && (
                    <span className="status-badge status-neutral">Base level</span>
                  )}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => move(i, -1)} disabled={i === 0}>
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => move(i, 1)} disabled={i === drafts.length - 1}>
                      <ArrowDown size={14} />
                    </button>
                    <button type="button" className="btn btn-secondary"
                      onClick={() => setDrafts(drafts.filter((_, n) => n !== i))}
                      disabled={drafts.length === 1}>
                      <X size={14} />
                    </button>
                  </span>
                </div>
                <div className="grid-cols-2">
                  <div className="form-group">
                    <label className="form-label">Level name</label>
                    <input className="form-input" value={d.name}
                      onChange={(e) => update(i, { name: e.target.value })}
                      placeholder="Dean" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tag code (optional)</label>
                    <input className="form-input" value={d.tagCode}
                      onChange={(e) => update(i, { tagCode: e.target.value })}
                      placeholder="dean" />
                  </div>
                </div>
              </div>
            ))}

            <button type="button" className="btn btn-secondary" onClick={() => setDrafts([...drafts, emptyDraft()])}>
              <Plus size={15} /> Add another level
            </button>

            <span className="form-hint">
              The last level in this list becomes the base level — the rank students sit at.
              Ranks are fixed once created; further levels can be added later from the dashboard.
            </span>
          </div>

          <div className="wizard-footer">
            <span />
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Creating levels...' : 'Create levels'} <Check size={16} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
