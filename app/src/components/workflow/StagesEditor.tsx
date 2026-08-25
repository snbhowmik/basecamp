import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { errorMessage } from '../../lib/errors';
import {
  getCategoryWorkflow, saveCategoryStages, saveStageTasks, saveCategoryInitiators,
  type Stage, type StageTask, type CategoryWorkflow,
  type AnswerType, type TaskActor, type TaskScope, type StageKind,
} from '../../lib/workflow';
import type { PriorityLevel, RequestCategory, Tag } from '../../types';

// The captain writes the workflow here: who may file a category, and the
// stages a request walks with the tasks that have to be filled in at each.
// Nothing is saved as it is typed — the draft lives in this component until
// Save, which sends it as whole sets (schema-v2/0027).

const ANSWER_TYPES: { value: AnswerType; label: string }[] = [
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'choice', label: 'One of a list' },
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'file', label: 'File upload' },
  { value: 'acknowledge', label: 'Acknowledge' },
];

const ACTORS: { value: TaskActor; label: string }[] = [
  { value: 'stage_role', label: 'Whoever it is with' },
  { value: 'requester', label: 'The requester' },
  { value: 'any_participant', label: 'Anyone on it' },
];

const list = (v: string[] | null) => (v ?? []).join(', ');
const parseList = (s: string) => {
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : null;
};

const renumberTasks = (ts: StageTask[]) => ts.map((t, n) => ({ ...t, sort_order: n }));

const emptyTask = (sortOrder: number): StageTask => ({
  id: null,
  label: '',
  answer_type: 'yes_no',
  options: null,
  passing_answers: null,
  actor: 'stage_role',
  scope: 'request',
  is_required: true,
  sort_order: sortOrder,
});

export default function StagesEditor({
  category, levels, tags, onClose,
}: {
  category: RequestCategory;
  levels: PriorityLevel[];
  tags: Tag[];
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<CategoryWorkflow | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [initiators, setInitiators] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getCategoryWorkflow(category.id)
      .then((w) => {
        if (!live) return;
        setLoaded(w);
        setStages(w.stages.map((s) => ({ ...s, tasks: [...s.tasks] })));
        setInitiators(w.initiators.map((i) => i.tag_id));
      })
      .catch((err) => setError(errorMessage(err, 'Could not load this category’s workflow.')));
    return () => { live = false; };
  }, [category.id]);

  const dirty = useMemo(() => {
    if (!loaded) return false;
    const strip = (ss: Stage[]) => ss.map((s) => ({
      id: s.id, stage_no: s.stage_no, name: s.name, level_id: s.level_id,
      is_optional: s.is_optional, stage_kind: s.stage_kind,
      tasks: s.tasks,
    }));
    return JSON.stringify(strip(stages)) !== JSON.stringify(strip(loaded.stages))
      || JSON.stringify([...initiators].sort()) !== JSON.stringify(loaded.initiators.map((i) => i.tag_id).sort());
  }, [stages, initiators, loaded]);

  const patchStage = (i: number, patch: Partial<Stage>) =>
    setStages((prev) => prev.map((s, n) => {
      if (n !== i) return s;
      const next = { ...s, ...patch };
      // A follow-up stage sits on nobody's desk, so "whoever it is with"
      // has no answer there. Move those tasks over as the kind is flipped,
      // rather than letting the select show a value it no longer offers and
      // the save fail on 0029's guard.
      if (next.stage_kind === 'post_approval' && s.stage_kind !== 'post_approval') {
        next.tasks = next.tasks.map((t) => (
          t.actor === 'stage_role' ? { ...t, actor: 'requester' as TaskActor } : t
        ));
      }
      return next;
    }));

  const patchTask = (si: number, ti: number, patch: Partial<StageTask>) =>
    setStages((prev) => prev.map((s, n) => (n === si
      ? { ...s, tasks: s.tasks.map((t, m) => (m === ti ? { ...t, ...patch } : t)) }
      : s)));

  const renumber = (ss: Stage[]) => ss.map((s, n) => ({ ...s, stage_no: n + 1 }));

  const addStage = () => setStages((prev) => renumber([...prev, {
    id: null, stage_no: prev.length + 1, name: '', level_id: levels[0]?.id ?? '',
    is_optional: false, stage_kind: 'approval', tasks: [],
  }]));

  const move = (i: number, by: number) => setStages((prev) => {
    const next = [...prev];
    const j = i + by;
    if (j < 0 || j >= next.length) return prev;
    [next[i], next[j]] = [next[j], next[i]];
    return renumber(next);
  });

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await saveCategoryInitiators(category.id, initiators);
      await saveCategoryStages(category.id, stages);

      // Stages just created have no id until the call above lands, so the
      // ids come back from one re-read rather than from a guess.
      const fresh = await getCategoryWorkflow(category.id);
      const before = new Map(loaded?.stages.map((s) => [s.id, s.tasks]) ?? []);

      for (const draft of stages) {
        const saved = fresh.stages.find((s) => s.stage_no === draft.stage_no);
        if (!saved?.id) continue;
        const unchanged = draft.id
          && JSON.stringify(before.get(draft.id) ?? []) === JSON.stringify(draft.tasks);
        if (unchanged) continue;
        await saveStageTasks(saved.id, draft.tasks);
      }

      const after = await getCategoryWorkflow(category.id);
      setLoaded(after);
      setStages(after.stages.map((s) => ({ ...s, tasks: [...s.tasks] })));
      setInitiators(after.initiators.map((i) => i.tag_id));
    } catch (err) {
      setError(errorMessage(err, 'Could not save this workflow.'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (!loaded) return onClose();
    setStages(loaded.stages.map((s) => ({ ...s, tasks: [...s.tasks] })));
    setInitiators(loaded.initiators.map((i) => i.tag_id));
    setError('');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Workflow — {category.name}</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {error && <div className="alert alert-danger">{error}</div>}
          {!loaded ? <span className="form-hint">Loading…</span> : (
            <>
              <h3 className="section-title">Who can file this</h3>
              <p className="form-hint">
                Tick the roles allowed to raise this kind of request. Tick nothing and it stays
                open to everyone, which is what it is today.
              </p>
              <div className="sticky-picks" style={{ marginBottom: '1.5rem' }}>
                {tags.filter((t) => !t.code.startsWith('org:')).map((t) => (
                  <label key={t.id} className={`sticky-pick ${initiators.includes(t.id) ? 'on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={initiators.includes(t.id)}
                      onChange={(e) => setInitiators((prev) => (
                        e.target.checked ? [...prev, t.id] : prev.filter((x) => x !== t.id)
                      ))}
                    />
                    <span>{t.label}</span>
                  </label>
                ))}
              </div>

              <h3 className="section-title">Stages and their tasks</h3>
              <p className="form-hint">
                A request walks these in order, and each one is checked by the role you pick. A
                stage is done when its tasks are filled in. A follow-up stage is not part of the
                approval — it opens once the request is approved, for the certificate or the
                photos after the event.
              </p>

              {stages.length === 0 && (
                <div className="empty-state" style={{ padding: '1.5rem' }}>
                  <span className="empty-title">No stages</span>
                  <span>Requests in this category go wherever the first-hop picker sends them.</span>
                </div>
              )}

              {stages.map((s, si) => (
                <div className="card" key={s.id ?? `new-${si}`} style={{ marginBottom: '1rem' }}>
                  <div className="card-body">
                    <div className="grid-cols-2">
                      <div className="form-group">
                        <label className="form-label">Stage {s.stage_no}</label>
                        <input className="form-input" value={s.name} placeholder="HOD approval"
                          onChange={(e) => patchStage(si, { name: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Checked by</label>
                        <select className="form-input" value={s.level_id}
                          onChange={(e) => patchStage(si, { level_id: e.target.value })}>
                          {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="grid-cols-2">
                      <div className="form-group">
                        <label className="form-label">Kind</label>
                        <select className="form-input" value={s.stage_kind}
                          onChange={(e) => patchStage(si, { stage_kind: e.target.value as StageKind })}>
                          <option value="approval">Part of the approval</option>
                          <option value="post_approval">Follow-up after approval</option>
                        </select>
                      </div>
                    </div>

                    <div className="table-container">
                      <table>
                        <thead>
                          <tr>
                            <th>Task</th><th>Answer</th><th>Filled in by</th>
                            <th>Per person</th><th>Required</th><th />
                          </tr>
                        </thead>
                        <tbody>
                          {s.tasks.map((t, ti) => (
                            <tr key={t.id ?? `new-${ti}`}>
                              <td>
                                <input className="form-input" value={t.label}
                                  placeholder="Parent permission taken"
                                  onChange={(e) => patchTask(si, ti, { label: e.target.value })} />
                                {(t.answer_type === 'choice' || t.answer_type === 'yes_no') && (
                                  <div className="grid-cols-2" style={{ marginTop: '0.5rem' }}>
                                    {t.answer_type === 'choice' && (
                                      <input className="form-input" value={list(t.options)}
                                        placeholder="Options, comma separated"
                                        onChange={(e) => patchTask(si, ti, { options: parseList(e.target.value) })} />
                                    )}
                                    <input className="form-input" value={list(t.passing_answers)}
                                      placeholder="Answers that clear it (blank: any)"
                                      onChange={(e) => patchTask(si, ti, { passing_answers: parseList(e.target.value) })} />
                                  </div>
                                )}
                              </td>
                              <td>
                                <select className="form-input" value={t.answer_type}
                                  onChange={(e) => patchTask(si, ti, { answer_type: e.target.value as AnswerType })}>
                                  {ANSWER_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                                </select>
                              </td>
                              <td>
                                <select className="form-input" value={t.actor}
                                  onChange={(e) => patchTask(si, ti, { actor: e.target.value as TaskActor })}>
                                  {ACTORS.filter((a) => !(s.stage_kind === 'post_approval' && a.value === 'stage_role'))
                                    .map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                                </select>
                              </td>
                              <td>
                                <input type="checkbox" checked={t.scope === 'per_participant'}
                                  onChange={(e) => patchTask(si, ti, {
                                    scope: (e.target.checked ? 'per_participant' : 'request') as TaskScope,
                                  })} />
                              </td>
                              <td>
                                <input type="checkbox" checked={t.is_required}
                                  onChange={(e) => patchTask(si, ti, { is_required: e.target.checked })} />
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <button className="btn-icon danger" title="Remove task"
                                  onClick={() => patchStage(si, { tasks: renumberTasks(s.tasks.filter((_, m) => m !== ti)) })}>
                                  <Trash2 size={15} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="filter-row" style={{ marginTop: '0.75rem' }}>
                      <button className="btn btn-secondary btn-sm"
                        onClick={() => patchStage(si, { tasks: renumberTasks([...s.tasks, emptyTask(s.tasks.length)]) })}>
                        <Plus size={14} /> Add task
                      </button>
                      <button className="btn-icon" title="Move up" onClick={() => move(si, -1)}><ArrowUp size={15} /></button>
                      <button className="btn-icon" title="Move down" onClick={() => move(si, 1)}><ArrowDown size={15} /></button>
                      <button className="btn-icon danger" title="Remove stage"
                        onClick={() => setStages((prev) => renumber(prev.filter((_, n) => n !== si)))}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              <button className="btn btn-secondary btn-sm" onClick={addStage} disabled={levels.length === 0}>
                <Plus size={14} /> Add stage
              </button>
            </>
          )}
        </div>

        <div className="modal-footer">
          {dirty
            ? <span className="form-hint">Unsaved changes.</span>
            : <span className="form-hint">Everything here is saved.</span>}
          <button className="btn btn-secondary" onClick={dirty ? cancel : onClose} disabled={busy}>
            {dirty ? 'Cancel changes' : 'Done'}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
