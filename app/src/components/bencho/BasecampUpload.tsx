import { useRef, useState, type DragEvent } from 'react';
import { Check, Upload as UpIcon } from 'lucide-react';
import { uploadAttachment } from '../../lib/attachments';

// The real upload dropzone — same box, same motion language as
// UploadDropzone.tsx's vendored demo (.upl-zone, .upl-icon, .upl-say,
// .upl-now, .upl-tick share its CSS), but this one reads an actual file
// from the OS via native drag-and-drop or a hidden <input type="file">,
// and calls attachments.ts's real uploadAttachment() — the demo's "NO REAL
// FILES" box with two hardcoded tiles was explicitly decorative, not a
// starting point for a working uploader.
//
// No fake rolling percentage: supabase-js's storage.upload() wraps fetch,
// which does not expose upload progress, so showing a invented number
// climbing would be a lie dressed as data. This shows "Uploading…" with
// the lens-roll's spirit (indeterminate) instead of counterfeiting a
// progress bar the network never reported.

const MAX_MB = 20; // matches storage-api's FILE_SIZE_LIMIT (docker-compose.yml)

const ALLOWED: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.ms-powerpoint': 'PPT',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'image/webp': 'WEBP',
  'image/gif': 'GIF',
};
const ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif';

function isAllowed(file: File): boolean {
  if (ALLOWED[file.type]) return true;
  // Some browsers send an empty/octet-stream type for a file the OS
  // itself knows the kind of (common for .docx over certain drag
  // sources) — fall back to the extension rather than refusing it.
  const ext = file.name.toLowerCase().split('.').pop();
  return !!ext && ACCEPT.includes(`.${ext}`);
}

function fmt(bytes: number): string {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`;
}

type Phase = { kind: 'idle' } | { kind: 'up'; name: string; size: number } | { kind: 'done'; name: string };

export default function BasecampUpload({
  requestId, onUploaded,
}: { requestId: string; onUploaded: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [over, setOver] = useState(false);
  const [refuse, setRefuse] = useState<string | null>(null);
  const refuseTimer = useRef<number>(0);
  const input = useRef<HTMLInputElement>(null);

  const say = (msg: string) => {
    setRefuse(msg);
    window.clearTimeout(refuseTimer.current);
    refuseTimer.current = window.setTimeout(() => setRefuse(null), 2400);
  };

  const run = async (file: File) => {
    if (!isAllowed(file)) { say('Only PDF, Word, PowerPoint or image files'); return; }
    if (file.size > MAX_MB * 1e6) { say(`Too big — up to ${MAX_MB} MB`); return; }
    setPhase({ kind: 'up', name: file.name, size: file.size });
    try {
      await uploadAttachment(requestId, file);
      setPhase({ kind: 'done', name: file.name });
      onUploaded();
      window.setTimeout(() => setPhase({ kind: 'idle' }), 1200);
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not upload that file.');
      setPhase({ kind: 'idle' });
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    if (phase.kind !== 'idle') return;
    const file = e.dataTransfer.files?.[0];
    if (file) run(file);
  };

  const busy = phase.kind !== 'idle';

  return (
    <div className="upl upl--real">
      <div
        className="upl-zone"
        data-over={over || undefined}
        data-refuse={refuse ? true : undefined}
        data-busy={busy || undefined}
        aria-live="polite"
        onDragOver={(e) => { e.preventDefault(); if (phase.kind === 'idle') setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={() => { if (phase.kind === 'idle') input.current?.click(); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && phase.kind === 'idle') input.current?.click(); }}
      >
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ''; }}
        />
        {phase.kind === 'idle' && (
          <>
            <span className="upl-icon"><UpIcon size={18} strokeWidth={2} /></span>
            <span className="upl-say">
              <b>{refuse ?? (over ? 'Drop to upload' : 'Drag a file here, or click to browse')}</b>
              <span>PDF, Word, PowerPoint or image · up to {MAX_MB} MB</span>
            </span>
          </>
        )}
        {phase.kind !== 'idle' && (
          <span className="upl-now">
            <span className="upl-text">
              <span className="upl-name">{phase.kind === 'up' ? phase.name : phase.name}</span>
              <span className="upl-meta">
                {phase.kind === 'up' ? `${fmt(phase.size)} · Uploading…` : 'Uploaded'}
              </span>
            </span>
            <span className="upl-end">
              {phase.kind === 'done' && <span className="upl-tick"><Check size={12} strokeWidth={3} /></span>}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
