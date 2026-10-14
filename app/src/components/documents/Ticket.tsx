import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { errorMessage } from '../../lib/errors';
import { renderDocument, verifyQrDataUrl } from '../../lib/documents';
import type { RequestRow } from '../../lib/requests';

// A ticket-styled view of an approved request — a two-part card (an upper
// panel and a tear-off stub, split by a perforated line) rather than the
// formal printable letter DocumentView.tsx renders. The mechanism is
// dqnamo.com's "Ticket" experiment: a composable ticket with a perforated
// stub and circular notches at the tear line. Original implementation —
// this shows the request's own fields instead of an event's generative
// dot-grid, and a QR (reusing documents.ts's verifyQrDataUrl, same code
// the printed document carries) in place of their decorative barcode.
//
// This is additional, not a replacement: the official document stays the
// serious printable letter. This is a friendlier confirmation view for an
// OD-style request, which usually *is* permission to attend an event.
export default function Ticket({
  requestId, docType, request, onClose,
}: {
  requestId: string;
  docType: string;
  request: RequestRow;
  onClose: () => void;
}) {
  const [referenceCode, setReferenceCode] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    renderDocument(requestId, docType)
      .then((d) => {
        setReferenceCode(d.reference_code);
        return verifyQrDataUrl(d.reference_code);
      })
      .then(setQrUrl)
      .catch((err) => setError(errorMessage(err, 'Could not generate the ticket.')));
  }, [requestId, docType]);

  const date = request.submitted_at ?? request.created_at;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="ticket-stage" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn-icon ticket-close" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>

        {error && <div className="alert alert-danger">{error}</div>}

        {!error && (
          <div className="ticket">
            <div className="ticket-body">
              <div className="ticket-kicker">{request.request_categories?.name ?? 'Request'}</div>
              <div className="ticket-title">{request.title}</div>
              {request.requester?.full_name && (
                <div className="ticket-field">
                  <span>Requested by</span>
                  <strong>{request.requester.full_name}</strong>
                </div>
              )}
              <div className="ticket-row">
                <div className="ticket-field">
                  <span>Date</span>
                  <strong>{new Date(date).toLocaleDateString()}</strong>
                </div>
                <div className="ticket-field">
                  <span>Status</span>
                  <strong>Approved</strong>
                </div>
              </div>
            </div>

            <div className="ticket-tear" aria-hidden="true">
              <span className="ticket-notch ticket-notch--left" />
              <span className="ticket-notch ticket-notch--right" />
            </div>

            <div className="ticket-stub">
              <div className="ticket-stub-text">
                <div className="ticket-field">
                  <span>Admit</span>
                  <strong>One</strong>
                </div>
                <div className="ticket-field">
                  <span>Reference</span>
                  <strong className="cell-mono">{referenceCode || '…'}</strong>
                </div>
              </div>
              {qrUrl && <img src={qrUrl} alt="Scan to verify" className="ticket-qr" />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
