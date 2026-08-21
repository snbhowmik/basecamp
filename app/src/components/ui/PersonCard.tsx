import { useEffect, useState } from 'react';
import { Mail, Building2, GraduationCap, StickyNote, Award } from 'lucide-react';
import Modal from './Modal';
import { errorMessage } from '../../lib/errors';
import { getMemberCard, getStickyNote, type MemberCard, type StickyNoteEntry } from '../../lib/account';

// The person card. Anyone signed in and MFA-verified may open anyone else's —
// the org chart is meant to be legible to the whole portal, so this is Tier 1
// from PRD-V2 §9.1 with its audience widened (schema-v2/0023 records why).
// Tier 2 — CGPA, proof, verification — is not here and is not reachable from
// here.
//
// Both reads are SECURITY DEFINER RPCs that re-check the caller themselves.
// Nothing on this screen is a permission decision.

export default function PersonCard({
  userId, name, onClose,
}: {
  userId: string;
  name: string;
  onClose: () => void;
}) {
  const [card, setCard] = useState<MemberCard | null>(null);
  const [note, setNote] = useState<StickyNoteEntry[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let live = true;
    setBusy(true);
    Promise.all([getMemberCard(userId), getStickyNote(userId)])
      .then(([c, n]) => { if (!live) return; setCard(c); setNote(n); })
      .catch((err) => { if (live) setError(errorMessage(err, 'Could not load this person.')); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [userId]);

  return (
    <Modal isOpen onClose={onClose} title={card?.full_name ?? name} maxWidth="440px">
      {error && <div className="alert alert-danger">{error}</div>}
      {busy && <div className="loading-spinner" role="status" aria-label="Loading profile" />}

      {!busy && !error && !card && (
        <p className="pcard-gone">This account is no longer active.</p>
      )}

      {card && (
        <>
          <dl className="pcard">
            <Field icon={<Mail size={14} />} label="Email" value={card.email} />
            {card.reg_no && <Field label="Register number" value={card.reg_no} mono />}
            {card.fet_id && <Field label="FET ID" value={card.fet_id} mono />}
            {card.level_name && <Field label="Role" value={card.level_name} />}
            <Field
              icon={<Building2 size={14} />}
              label="Department"
              value={card.org_unit_name ?? 'Not set'}
            />
            {(card.batch_name || card.section_name) && (
              <Field
                icon={<GraduationCap size={14} />}
                label="Batch and class"
                value={[card.batch_name, card.section_name].filter(Boolean).join(' · ')}
              />
            )}
          </dl>

          {note.length > 0 && (
            <div className="pcard-note">
              <p className="pcard-note-head">
                <StickyNote size={14} aria-hidden="true" /> Attached to
              </p>
              <ul role="list">
                {note.map((n) => (
                  <li key={n.level_id + n.user_id}>
                    <span className="pcard-note-role">{n.level_name}</span>
                    <span className="pcard-note-who">{n.full_name}</span>
                    <span className="pcard-note-via">{n.section_name ?? n.org_unit_name ?? 'organisation-wide'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(card.tech_count > 0 || card.non_tech_count > 0) && (
            <p className="pcard-counts">
              <Award size={13} aria-hidden="true" />
              {card.tech_count} tech · {card.non_tech_count} non-tech
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

function Field({
  icon, label, value, mono,
}: { icon?: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="pcard-field">
      <dt>{icon}{label}</dt>
      <dd className={mono ? 'pcard-mono' : undefined}>{value}</dd>
    </div>
  );
}
