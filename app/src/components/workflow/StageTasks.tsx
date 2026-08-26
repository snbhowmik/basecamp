import { useEffect, useRef, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { errorMessage } from '../../lib/errors';
import {
  getRequestStageStatus, recordTaskResult,
  type StageStatus, type StageStatusTask, type TaskResult, type StageParticipant,
} from '../../lib/workflow';
import { uploadAttachment } from '../../lib/attachments';
import type { RequestRow } from '../../lib/requests';
import type { UserContext } from '../../lib/context';

// The current stage's tasks, read straight off the request rather than a
// dedicated RPC (see getRequestStageStatus). One row per (task, participant)
// pair for per_participant scope, one row per task otherwise. Answering a
// task overwrites whatever was there before — there is no per-task audit
// trail (HANDOFF §7).
export default function StageTasks({
  ctx, request, onTaskSaved,
}: { ctx: UserContext; request: RequestRow; onTaskSaved: () => void }) {
  const [status, setStatus] = useState<StageStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    getRequestStageStatus(request.id, request.current_stage_id)
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, [request.id, request.current_stage_id]);

  if (loading || !status || status.tasks.length === 0) return null;

  const findResult = (taskId: string, participantId: string | null) => status.results.find(
    (r) => r.task_id === taskId && r.participant_id === participantId,
  );

  const canAct = (task: StageStatusTask, participant: StageParticipant | null) => {
    if (ctx.isCaptain) return true;
    if (task.actor === 'stage_role') return request.current_holder === ctx.profile.id;
    if (task.actor === 'requester') return request.requested_by === ctx.profile.id;
    // any_participant: the requester, or the participant themselves once accepted.
    return request.requested_by === ctx.profile.id
      || (participant?.member_id === ctx.profile.id && participant.acceptance_status === 'accepted');
  };

  const actorHint = (actor: StageStatusTask['actor']) => {
    if (actor === 'stage_role') return 'Filled in by whoever the request is currently with.';
    if (actor === 'requester') return 'Filled in by the person who raised the request.';
    return 'Filled in by the requester or the participant it concerns.';
  };

  return (
    <div className="form-group">
      <span className="detail-label">{status.stage_name} — tasks</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
        {status.tasks.map((task) => (
          task.scope === 'per_participant' ? (
            status.participants.length === 0 ? (
              <TaskRow
                key={task.id}
                task={task}
                participant={null}
                result={undefined}
                editable={false}
                hint="No participants on this request yet."
                requestId={request.id}
                onSaved={() => { load(); onTaskSaved(); }}
              />
            ) : status.participants.map((p) => (
              <TaskRow
                key={`${task.id}:${p.id}`}
                task={task}
                participant={p}
                result={findResult(task.id, p.id)}
                editable={canAct(task, p)}
                hint={actorHint(task.actor)}
                requestId={request.id}
                onSaved={() => { load(); onTaskSaved(); }}
              />
            ))
          ) : (
            <TaskRow
              key={task.id}
              task={task}
              participant={null}
              result={findResult(task.id, null)}
              editable={canAct(task, null)}
              hint={actorHint(task.actor)}
              requestId={request.id}
              onSaved={() => { load(); onTaskSaved(); }}
            />
          )
        ))}
      </div>
    </div>
  );
}

function TaskRow({
  task, participant, result, editable, hint, requestId, onSaved,
}: {
  task: StageStatusTask;
  participant: StageParticipant | null;
  result: TaskResult | undefined;
  editable: boolean;
  hint: string;
  requestId: string;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<string>(() => (
    result ? String((result.answer as string | number | undefined) ?? '') : ''
  ));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (value === '') return;
    setBusy(true);
    setError('');
    try {
      const answer = task.answer_type === 'number' ? Number(value) : value;
      await recordTaskResult(requestId, task.id, answer, participant?.id ?? null);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not save this answer.'));
    } finally {
      setBusy(false);
    }
  };

  const submitFile = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      const attachmentId = await uploadAttachment(requestId, file);
      await recordTaskResult(
        requestId, task.id, { attachment_id: attachmentId, file_name: file.name }, participant?.id ?? null,
      );
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not save that file.'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const label = participant ? `${task.label} — ${participant.snapshot_name}` : task.label;

  if (task.answer_type === 'file') {
    const fileName = result ? (result.answer as { file_name?: string } | null)?.file_name : undefined;
    return (
      <div className="card" style={{ padding: '0.75rem 1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 550, fontSize: '0.9rem' }}>
              {label}{task.is_required && <span style={{ color: 'var(--state-rejected)' }}> *</span>}
            </div>
            {result ? (
              <span className="status-badge status-success">Uploaded: {fileName ?? 'file'}</span>
            ) : (
              <span className="form-hint">{hint}</span>
            )}
          </div>
          {editable && (
            <div>
              <input
                ref={fileRef}
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) submitFile(f); }}
              />
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Paperclip size={14} /> {busy ? 'Uploading...' : result ? 'Replace file' : 'Attach file'}
              </button>
            </div>
          )}
        </div>
        {error && <div className="alert alert-danger" style={{ marginTop: '0.5rem' }}>{error}</div>}
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: '0.75rem 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 550, fontSize: '0.9rem' }}>
            {label}{task.is_required && <span style={{ color: 'var(--state-rejected)' }}> *</span>}
          </div>
          {result && (
            <span className={result.result === 'failed' ? 'status-badge status-danger' : 'status-badge status-success'}>
              {result.result === 'failed' ? 'Recorded — did not clear' : 'Recorded'}
            </span>
          )}
        </div>
        {editable ? (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {task.answer_type === 'yes_no' && (
              <select className="form-input" value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Select...</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            )}
            {task.answer_type === 'choice' && (
              <select className="form-input" value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Select...</option>
                {(task.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {task.answer_type === 'acknowledge' && (
              <select className="form-input" value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Select...</option>
                <option value="acknowledged">Acknowledge</option>
              </select>
            )}
            {(task.answer_type === 'text' || task.answer_type === 'number' || task.answer_type === 'date') && (
              <input
                className="form-input"
                type={task.answer_type === 'number' ? 'number' : task.answer_type === 'date' ? 'date' : 'text'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
            <button className="btn btn-secondary btn-sm" disabled={busy || value === ''} onClick={submit}>
              {result ? 'Update' : 'Save'}
            </button>
          </div>
        ) : (
          <span className="form-hint">{result ? String((result.answer as string | number | undefined) ?? '') : hint}</span>
        )}
      </div>
      {error && <div className="alert alert-danger" style={{ marginTop: '0.5rem' }}>{error}</div>}
    </div>
  );
}
