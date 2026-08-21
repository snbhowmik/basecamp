import { useEffect, useState } from 'react';
import { StickyNote } from 'lucide-react';
import { errorMessage } from '../../lib/errors';
import { listStickyNoteRules, setStickyNoteRoles } from '../../lib/levels';
import type { PriorityLevel } from '../../types';

// Who the organisation attaches to a person. Ticking Mentor and Head of
// Department on the Student rung means every student's card names their own
// mentor and their own HOD — resolved from role_assignments on read, so nobody
// types a name and nothing needs keeping in sync.
//
// A rung with nothing ticked has no sticky note. That is the off switch: there
// is no separate toggle to leave disagreeing with the rules underneath it.

export default function StickyNoteSettings({ levels }: { levels: PriorityLevel[] }) {
  const [shown, setShown] = useState<Map<string, Set<string>>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listStickyNoteRules()
      .then((rules) => {
        const next = new Map<string, Set<string>>();
        for (const r of rules) {
          const set = next.get(r.subject_level_id) ?? new Set<string>();
          set.add(r.shown_level_id);
          next.set(r.subject_level_id, set);
        }
        setShown(next);
      })
      .catch((err) => setError(errorMessage(err, 'Could not load sticky note settings.')));
  }, []);

  const toggle = async (subjectId: string, shownId: string) => {
    const current = new Set(shown.get(subjectId) ?? []);
    if (current.has(shownId)) current.delete(shownId); else current.add(shownId);

    // Ordered by rank so a card reads top-down the way the ladder does —
    // Head of Department above Mentor, not in click order.
    const ordered = levels
      .filter((l) => current.has(l.id))
      .map((l) => l.id);

    setBusy(subjectId + shownId);
    setError('');
    try {
      await setStickyNoteRoles(subjectId, ordered);
      setShown((prev) => new Map(prev).set(subjectId, current));
    } catch (err) {
      setError(errorMessage(err, 'Could not save that.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card" style={{ marginBottom: '1.25rem' }}>
      <div className="card-header">
        <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <StickyNote size={16} /> Sticky notes
        </h2>
      </div>
      <div className="card-body">
        <p className="form-hint" style={{ marginBottom: '1rem' }}>
          Choose which rungs appear on each rung's person card. Tick Mentor and Head of Department
          on Student and every student's card names their own mentor and HOD — worked out from who
          holds what, over which department or class. Nobody types a name in, so nothing goes stale.
          A rung with nothing ticked has no sticky note.
        </p>

        {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}

        <div className="table-container">
          <table>
            <thead>
              <tr><th>Card belongs to</th><th>Shows</th></tr>
            </thead>
            <tbody>
              {levels.map((subject) => (
                <tr key={subject.id}>
                  <td><span className="cell-strong">{subject.name}</span></td>
                  <td>
                    <div className="sticky-picks">
                      {levels.filter((l) => l.id !== subject.id).map((l) => {
                        const on = shown.get(subject.id)?.has(l.id) ?? false;
                        return (
                          <label key={l.id} className={`sticky-pick ${on ? 'on' : ''}`}>
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={busy !== null}
                              onChange={() => toggle(subject.id, l.id)}
                            />
                            {l.name}
                          </label>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
