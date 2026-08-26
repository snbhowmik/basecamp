import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage } from '../../lib/errors';
import { listParticipants, addParticipantByRegNo, respondToParticipation, type Participant } from '../../lib/participants';
import { getCategory } from '../../lib/org';
import type { RequestCategory } from '../../types';
import type { RequestRow } from '../../lib/requests';
import type { UserContext } from '../../lib/context';

// Outstation participants (PRD-V2 §6): the requester or a club admin adds
// students by register number, each accepts or declines their own place on
// the request — peer consent, distinct from approval. Accept/decline is a
// direct table update because 0003's RLS policy was built for exactly that
// (see lib/participants.ts); adding is the RPC, because the window and the
// "who may add" rule need server-side enforcement.
export default function ParticipantsPanel({
  ctx, request,
}: { ctx: UserContext; request: RequestRow }) {
  const [category, setCategory] = useState<RequestCategory | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [regNo, setRegNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    Promise.all([getCategory(request.category_id), listParticipants(request.id)])
      .then(([cat, ps]) => { setCategory(cat); setParticipants(ps); })
      .finally(() => setLoaded(true));
  };

  useEffect(load, [request.id, request.category_id]);

  if (!loaded || !category) return null;

  const windowOpen = category.participant_phase === 'after_approval'
    && request.participants_open_until
    && new Date(request.participants_open_until) > new Date();
  const windowClosed = category.participant_phase === 'after_approval'
    && request.participants_open_until
    && new Date(request.participants_open_until) <= new Date();

  const canAdd = category.participant_phase === 'before_submit'
    ? (request.requested_by === ctx.profile.id || ctx.isCaptain)
    : (windowOpen || ctx.isCaptain);

  if (participants.length === 0 && !canAdd) return null;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!regNo.trim()) return;
    setBusy(true);
    setError('');
    try {
      await addParticipantByRegNo(request.id, regNo.trim());
      setRegNo('');
      load();
    } catch (err) {
      setError(errorMessage(err, 'Could not add that participant.'));
    } finally {
      setBusy(false);
    }
  };

  const respond = async (id: string, accept: boolean) => {
    setBusy(true);
    setError('');
    try {
      await respondToParticipation(id, accept);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Could not record your response.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-group">
      <span className="detail-label">Participants</span>

      {category.participant_phase === 'after_approval' && (
        <p className="form-hint">
          {windowOpen && request.participants_open_until
            && `Adding closes ${new Date(request.participants_open_until).toLocaleDateString()}.`}
          {windowClosed && 'The window for adding participants has closed.'}
          {!request.participants_open_until && 'Participants can be added once this request is approved.'}
        </p>
      )}

      {error && <div className="alert alert-danger">{error}</div>}

      {participants.length > 0 && (
        <div className="table-container" style={{ marginTop: '0.5rem' }}>
          <table>
            <thead><tr><th>Name</th><th>Reg No</th><th>Status</th><th /></tr></thead>
            <tbody>
              {participants.map((p) => (
                <tr key={p.id}>
                  <td className="cell-strong">{p.snapshot_name}{p.is_leader && ' (leader)'}</td>
                  <td className="cell-mono">{p.snapshot_reg_no}</td>
                  <td>
                    <span className={
                      p.acceptance_status === 'accepted' ? 'status-badge status-success'
                        : p.acceptance_status === 'declined' ? 'status-badge status-danger'
                          : 'status-badge status-warning'
                    }
                    >
                      {p.acceptance_status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {p.member_id === ctx.profile.id && p.acceptance_status === 'pending' && (
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => respond(p.id, false)}>Decline</button>
                        <button className="btn btn-success btn-sm" disabled={busy} onClick={() => respond(p.id, true)}>Accept</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canAdd && (
        <form onSubmit={add} className="repeatable-row" style={{ marginTop: '0.75rem' }}>
          <input
            className="form-input"
            placeholder="Register number"
            value={regNo}
            onChange={(e) => setRegNo(e.target.value)}
          />
          <button className="btn btn-secondary" type="submit" disabled={busy}>Add</button>
        </form>
      )}
    </div>
  );
}
