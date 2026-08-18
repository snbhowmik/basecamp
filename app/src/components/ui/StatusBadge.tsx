import type { RequestStatus } from '../../types';

// Maps the real `request_status` enum (schema-v2/0002_requests.sql) to a label
// + color class. v2 dropped `cancelled`.
const STATUS_MAP: Record<RequestStatus, { label: string; className: string }> = {
  draft:              { label: 'Draft',             className: 'status-neutral' },
  submitted:          { label: 'Submitted',         className: 'status-progress' },
  in_review:          { label: 'In Review',         className: 'status-progress' },
  changes_requested:  { label: 'Changes Requested', className: 'status-warning' },
  approved:           { label: 'Approved',          className: 'status-success' },
  rejected:           { label: 'Rejected',          className: 'status-danger' },
  reviewed:           { label: 'Reviewed',          className: 'status-success' },
  closed:             { label: 'Closed',             className: 'status-neutral' },
};

export default function StatusBadge({ status }: { status: RequestStatus | string }) {
  const mapped = STATUS_MAP[status as RequestStatus] ?? {
    label: status.charAt(0).toUpperCase() + status.slice(1),
    className: 'status-neutral',
  };

  return <span className={`status-badge ${mapped.className}`}>{mapped.label}</span>;
}
