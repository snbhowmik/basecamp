import { useEffect, useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { errorMessage } from '../../lib/errors';
import { listAttachments, getAttachmentUrl, deleteAttachment, type Attachment } from '../../lib/attachments';
import BasecampUpload from '../bencho/BasecampUpload';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Anyone who can see the request may upload — attachments_write's own
// check (uploaded_by = auth.uid() and can_see_request(request_id)) is the
// real gate, so there's no narrower client-side rule to mirror here.
//
// Delete is narrower (0037): the uploader only, not anyone who can see the
// request. currentUserId decides whether this row's delete button shows at
// all — attachments_delete's RLS check is the real gate either way, this
// just avoids offering a button that would be refused.
export default function Attachments({ requestId, currentUserId }: { requestId: string; currentUserId: string }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = () => { listAttachments(requestId).then(setItems).catch(() => setItems([])); };
  useEffect(load, [requestId]);

  const open = async (a: Attachment) => {
    try {
      const url = await getAttachmentUrl(a.object_key);
      if (url) window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(errorMessage(err, 'Could not open that file.'));
    }
  };

  const remove = async (a: Attachment) => {
    setDeleting(a.id);
    setError('');
    try {
      await deleteAttachment(a);
      setConfirming(null);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Could not delete that file.'));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="form-group">
      <span className="detail-label">Attachments</span>
      {error && <div className="alert alert-danger">{error}</div>}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem', marginBottom: '0.75rem' }}>
          {items.map((a) => (
            <div key={a.id} style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ flex: 1, justifyContent: 'space-between' }}
                onClick={() => open(a)}
              >
                <span><Download size={14} /> {a.file_name}</span>
                <span className="cell-mono">{formatSize(a.size_bytes)}</span>
              </button>
              {a.uploaded_by === currentUserId && (
                confirming === a.id ? (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={deleting === a.id}
                    onClick={() => remove(a)}
                    onBlur={() => setConfirming(null)}
                    autoFocus
                  >
                    {deleting === a.id ? '...' : 'Confirm'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-icon danger"
                    aria-label={`Delete ${a.file_name}`}
                    title="Delete"
                    onClick={() => setConfirming(a.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: '0.5rem' }}>
        <BasecampUpload requestId={requestId} onUploaded={load} />
      </div>
    </div>
  );
}
