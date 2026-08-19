import { useEffect, useState } from 'react';
import { Printer, X, ShieldCheck } from 'lucide-react';
import { errorMessage } from '../../lib/errors';
import { renderDocument, sanitizeDocumentHtml, type RenderedDocument } from '../../lib/documents';

interface DocumentViewProps {
  requestId: string;
  docType: string;
  onClose: () => void;
}

// Renders a generated document and hands it to the browser's print dialog,
// which is where the PDF comes from.
//
// There is no server-side PDF renderer on purpose: PRD-V2 §14 rules out an API
// server, and PRD §14.4 makes the file disposable — what is protected is the
// generated_documents row (reference code + state hash), which the database
// already minted before this component drew anything. Byte-identical output
// across browsers buys nothing when the record, not the file, is the artefact.
export default function DocumentView({ requestId, docType, onClose }: DocumentViewProps) {
  const [doc, setDoc] = useState<RenderedDocument | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    renderDocument(requestId, docType)
      .then(setDoc)
      .catch((err) => setError(errorMessage(err, 'Could not generate the document.')));
  }, [requestId, docType]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content doc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header no-print">
          <h2 className="modal-title">{doc?.template_name ?? 'Document'}</h2>
          <button type="button" className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          {error && <div className="alert alert-danger">{error}</div>}
          {!doc && !error && <div className="loading-spinner" />}

          {doc && (
            <>
              <div className="doc-sheet" id="doc-print-area">
                <div dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(doc.html) }} />

                {/* Printed onto the document itself, because a reference code
                    that only exists on screen cannot be checked from paper. */}
                <div className="doc-footer">
                  <span>Reference: <strong>{doc.reference_code}</strong></span>
                  <span>Verify at {window.location.origin}/verify</span>
                </div>
              </div>

              <p className="text-muted no-print" style={{ fontSize: '0.85rem' }}>
                <ShieldCheck size={14} /> This document can be regenerated identically at any time.
                Anyone can confirm it at <code>/verify</code> using the reference code — no account needed.
              </p>
            </>
          )}
        </div>

        <div className="modal-footer no-print">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" onClick={() => window.print()} disabled={!doc}>
            <Printer size={16} /> Print / Save as PDF
          </button>
        </div>
      </div>
    </div>
  );
}
