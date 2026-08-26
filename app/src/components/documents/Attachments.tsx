import { useEffect, useRef, useState } from 'react';
import { Paperclip, Download } from 'lucide-react';
import { errorMessage } from '../../lib/errors';
import { listAttachments, uploadAttachment, getAttachmentUrl, type Attachment } from '../../lib/attachments';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => { listAttachments(requestId).then(setItems).catch(() => setItems([])); };
  useEffect(load, [requestId]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      await uploadAttachment(requestId, file);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Could not upload that file.'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const open = async (a: Attachment) => {
    try {
      const url = await getAttachmentUrl(a.object_key);
      if (url) window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(errorMessage(err, 'Could not open that file.'));
    }
  };

  if (items.length === 0 && !busy) {
    return (
      <div className="form-group">
        <span className="detail-label">Attachments</span>
        {error && <div className="alert alert-danger">{error}</div>}
        <div style={{ marginTop: '0.5rem' }}>
          <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onPick} />
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Paperclip size={14} /> Attach a file
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="form-group">
      <span className="detail-label">Attachments</span>
      {error && <div className="alert alert-danger">{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem' }}>
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
      <div style={{ marginTop: '0.5rem' }}>
        <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onPick} />
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Paperclip size={14} /> {busy ? 'Uploading...' : 'Attach a file'}
        </button>
      </div>
    </div>
  );
}
