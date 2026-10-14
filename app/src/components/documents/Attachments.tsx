import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { errorMessage } from '../../lib/errors';
import { listAttachments, getAttachmentUrl, type Attachment } from '../../lib/attachments';
import BasecampUpload from '../bencho/BasecampUpload';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Anyone who can see the request may upload — attachments_write's own
// check (uploaded_by = auth.uid() and can_see_request(request_id)) is the
// real gate, so there's no narrower client-side rule to mirror here.
export default function Attachments({ requestId }: { requestId: string }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [error, setError] = useState('');

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

  return (
    <div className="form-group">
      <span className="detail-label">Attachments</span>
      {error && <div className="alert alert-danger">{error}</div>}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem', marginBottom: '0.75rem' }}>
          {items.map((a) => (
            <button
              key={a.id}
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ justifyContent: 'space-between' }}
              onClick={() => open(a)}
            >
              <span><Download size={14} /> {a.file_name}</span>
              <span className="cell-mono">{formatSize(a.size_bytes)}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ marginTop: '0.5rem' }}>
        <BasecampUpload requestId={requestId} onUploaded={load} />
      </div>
    </div>
  );
}
