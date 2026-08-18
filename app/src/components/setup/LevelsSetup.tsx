import { useEffect, useState, type FormEvent } from 'react';
import { Plus, X, ArrowUp, ArrowDown, Check, Lock } from 'lucide-react';
import { listLevels, completeLevelSetup, appendLevel, type DraftLevel } from '../../lib/levels';
import type { PriorityLevel, Tag } from '../../types';
import { listTags } from '../../lib/invites';

// The authority ladder. Rank 1 is the highest; the lowest is the base level
// that students sit at. The captain is NOT on this ladder — they are the
// 'admin' tag and sit above it — so the list below starts at whatever the
// captain calls their top rung (Dean, Principal, Director, ...).
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

  const tagLabelFor = (id: string | null) =>
    id ? tags.find((t) => t.id === id)?.code ?? '—' : null;

  // ---------------- manage ----------------
  if (mode === 'manage') {
    return (
      <>
        {error && <div className="alert alert-danger" style={{ marginBottom: '1.25rem' }}>{error}</div>}

        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <div className="card-header">
            <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Lock size={16} /> Authority ladder
            </h2>
          </div>
          <div className="card-body">
            <p className="form-hint" style={{ marginBottom: '1rem' }}>
              Ranks are fixed once created — tickets in flight reference a level and expect its
              position to hold still. New levels can be added at the bottom.
            </p>
            <div className="table-container">
              <table>
                <thead><tr><th>Rank</th><th>Level</th><th>Tag</th><th>Base</th></tr></thead>
                <tbody>
                  {existing.map((l) => (
                    <tr key={l.id}>
                      <td className="cell-mono">{l.rank}</td>
                      <td className="cell-strong">{l.name}</td>
                      <td>
                        {tagLabelFor(l.tag_id)
                          ? <span className="chip">{tagLabelFor(l.tag_id)}</span>
                          : <span className="detail-value empty">No tag yet</span>}
                      </td>
                      <td>{l.is_base ? <span className="status-badge status-neutral">Base</span> : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h2 className="section-title">Add a level</h2></div>
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
                List the ranks in your organisation, highest first. You are the captain and sit
                above all of them, so do not add yourself. A tag is what identifies the people who
                hold a level — you can leave it blank now and fill it in later.
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
