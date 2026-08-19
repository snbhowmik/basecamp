import { errorMessage } from '../../lib/errors';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, Inbox, Search, Send } from 'lucide-react';
import type { UserContext } from '../../lib/context';
import {
  listVisibleRequests,
  listFirstHopCandidates,
  submitRequest,
  decideRequest,
  forwardRequest,
  searchForwardTargets,
  listHistory,
  listComments,
  addComment,
  listFieldDefinitions,
  listFieldValues,
  saveFieldValues,
  type FieldDefinition,
  type FieldValue,
  type RequestRow,
  type FirstHopCandidate,
  type ForwardTarget,
  type HistoryRow,
  type CommentRow,
} from '../../lib/requests';
import { listCategories } from '../../lib/org';
import type { RequestCategory } from '../../types';
import StatusBadge from '../ui/StatusBadge';
import Modal from '../ui/Modal';

type Filter = 'all' | 'mine' | 'desk';

// field_definitions.options is jsonb — a bare array for a select, anything
// else for other types. Tolerate both shapes rather than trusting one.
function fieldOptions(d: FieldDefinition): string[] {
  if (Array.isArray(d.options)) return d.options.map(String);
  return [];
}

// request_field_values.value is jsonb. Numbers go in as numbers so they sort
// and compare properly; everything else as a JSON string.
function coerceFieldValue(d: FieldDefinition, raw: string | undefined): unknown {
  const v = (raw ?? '').trim();
  if (v === '') return null;
  if (d.field_type === 'number') {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  return v;
}

// jsonb comes back parsed; render scalars directly and anything structured as
// JSON rather than "[object Object]".
function renderFieldValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

export default function RequestsPage({ ctx }: { ctx: UserContext }) {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [categories, setCategories] = useState<RequestCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>(ctx.isStaff ? 'desk' : 'mine');
  const [query, setQuery] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<RequestRow | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const [reqs, cats] = await Promise.all([listVisibleRequests(), listCategories()]);
      setRequests(reqs);
      setCategories(cats.filter((c) => c.is_active));
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load requests.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const visible = useMemo(() => {
    let rows = requests;
    if (filter === 'mine') rows = rows.filter((r) => r.requested_by === ctx.profile.id);
    if (filter === 'desk') rows = rows.filter((r) => r.current_holder === ctx.profile.id);
    if (query.trim()) {
      const q = query.toLowerCase();
      // Custom field values are not loaded for the list, so search covers the
      // fixed columns only. Searching inside field values needs a server-side
      // filter, not a client-side one over rows we do not have.
      rows = rows.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.reference_number.toLowerCase().includes(q) ||
          (r.body ?? '').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [requests, filter, query, ctx.profile.id]);

  // Only leaf categories are selectable — a parent like "Tech" is a grouping,
  // not something you file against.
  const leafCategories = useMemo(() => {
    const parentIds = new Set(categories.map((c) => c.parent_id).filter(Boolean));
    return categories.filter((c) => !parentIds.has(c.id));
  }, [categories]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Requests</h1>
          <p className="page-subtitle">Everything you've raised, plus anything routed to you.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          <Plus size={16} /> New request
        </button>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: '1.25rem' }}>{error}</div>}

      <div className="card">
        <div className="toolbar">
          <div className="filter-row">
            {ctx.isStaff && (
              <button className={`btn btn-sm ${filter === 'desk' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('desk')}>
                On my desk
              </button>
            )}
            <button className={`btn btn-sm ${filter === 'mine' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('mine')}>
              Raised by me
            </button>
            <button className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('all')}>
              All visible
            </button>
          </div>
          <div style={{ position: 'relative', minWidth: 220 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="form-input"
              style={{ paddingLeft: '2rem' }}
              placeholder="Search requests..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '3rem' }}><div className="loading-spinner" /></div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon"><Inbox size={20} /></span>
            <span className="empty-title">Nothing here</span>
            <span>
              {filter === 'desk'
                ? 'No requests are waiting on you right now.'
                : filter === 'mine'
                  ? "You haven't raised any requests yet."
                  : 'No requests are visible to you.'}
            </span>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Subject</th>
                  <th>Category</th>
                  {filter !== 'mine' && <th>Requester</th>}
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => setSelected(r)}>
                    <td className="cell-mono">{r.reference_number}</td>
                    <td>
                      <div className="cell-strong">{r.title}</div>
                    </td>
                    <td>{r.request_categories?.name ?? '—'}</td>
                    {filter !== 'mine' && <td>{r.requester?.full_name ?? '—'}</td>}
                    <td><StatusBadge status={r.status} /></td>
                    <td className="cell-mono">{new Date(r.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && (
        <NewRequestModal
          categories={leafCategories}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            reload();
          }}
        />
      )}

      {selected && (
        <RequestDetailModal
          ctx={ctx}
          request={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            reload();
          }}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------

function NewRequestModal({
  categories,
  onClose,
  onCreated,
}: {
  categories: RequestCategory[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  // The OD fields (event name, dates, travel scope, ...) are no longer columns
  // on `requests`. They are field_definitions rows attached to a category, so
  // the form is built from whatever the captain configured for the category
  // the user picked — and is empty until one is picked.
  const [fieldDefs, setFieldDefs] = useState<FieldDefinition[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [candidates, setCandidates] = useState<FirstHopCandidate[]>([]);
  const [firstHop, setFirstHop] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!categoryId) {
      setCandidates([]);
      setFirstHop('');
      setFieldDefs([]);
      setFieldValues({});
      return;
    }
    listFirstHopCandidates(categoryId)
      .then((c) => {
        setCandidates(c);
        setFirstHop(c[0]?.user_id ?? '');
      })
      .catch(() => setCandidates([]));
    listFieldDefinitions(categoryId)
      .then((d) => {
        setFieldDefs(d);
        setFieldValues({});
      })
      .catch(() => setFieldDefs([]));
  }, [categoryId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!categoryId) {
      setError('Pick a category.');
      return;
    }
    const missing = fieldDefs.filter((d) => d.is_required && !(fieldValues[d.id] ?? '').trim());
    if (missing.length > 0) {
      setError(`Required: ${missing.map((d) => d.label).join(', ')}.`);
      return;
    }
    setSubmitting(true);
    try {
      const requestId = await submitRequest({
        categoryId,
        title,
        body,
        firstHop: firstHop || null,
      });
      // Values are a second write: create_and_submit_request() takes only the
      // fixed columns. If this fails the request still exists, submitted and
      // missing its details — surfaced rather than swallowed.
      await saveFieldValues(
        requestId,
        fieldDefs.map((d) => ({ definitionId: d.id, value: coerceFieldValue(d, fieldValues[d.id]) })),
      );
      onCreated();
    } catch (err) {
      setError(errorMessage(err, 'Could not submit the request.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="New request"
      maxWidth="640px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit request'} <Send size={15} />
          </button>
        </>
      }
    >
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="form-group">
        <label className="form-label">Category</label>
        <select className="form-input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
          <option value="">Select a category...</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {categories.length === 0 && (
          <span className="form-hint">
            No categories are configured yet. The captain sets these up on the Workflow page.
          </span>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">Subject</label>
        <input className="form-input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary of what you're requesting" />
      </div>

      <div className="form-group">
        <label className="form-label">Details</label>
        <textarea className="form-input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Anything the approver needs to know" />
      </div>

      {fieldDefs.map((d) => (
        <div className="form-group" key={d.id}>
          <label className="form-label">{d.label}{d.is_required ? ' *' : ''}</label>
          {d.field_type === 'select' ? (
            <select
              className="form-input"
              value={fieldValues[d.id] ?? ''}
              onChange={(e) => setFieldValues({ ...fieldValues, [d.id]: e.target.value })}
            >
              <option value="">Select...</option>
              {fieldOptions(d).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : d.field_type === 'textarea' ? (
            <textarea
              className="form-input"
              value={fieldValues[d.id] ?? ''}
              onChange={(e) => setFieldValues({ ...fieldValues, [d.id]: e.target.value })}
            />
          ) : (
            <input
              className="form-input"
              type={d.field_type === 'date' ? 'date' : d.field_type === 'number' ? 'number' : 'text'}
              value={fieldValues[d.id] ?? ''}
              onChange={(e) => setFieldValues({ ...fieldValues, [d.id]: e.target.value })}
            />
          )}
        </div>
      ))}

      {categoryId && (
        <div className="form-group">
          <label className="form-label">Send to</label>
          {candidates.length === 0 ? (
            <span className="form-hint">
              No recipients are configured for this category yet — it'll be submitted unassigned and
              someone with access will need to pick it up. Your mentor and HOD are added as watchers
              automatically either way.
            </span>
          ) : (
            <select className="form-input" value={firstHop} onChange={(e) => setFirstHop(e.target.value)}>
              {candidates.map((c) => (
                <option key={c.user_id} value={c.user_id}>
                  {c.full_name} — {c.option_label}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------

function RequestDetailModal({
  ctx,
  request,
  onClose,
  onChanged,
}: {
  ctx: UserContext;
  request: RequestRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [fieldValues, setFieldValues] = useState<FieldValue[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [note, setNote] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [commentVisibility, setCommentVisibility] = useState<'public' | 'internal'>('public');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [forwardQuery, setForwardQuery] = useState('');
  const [forwardResults, setForwardResults] = useState<ForwardTarget[]>([]);
  const [showForward, setShowForward] = useState(false);

  const isHolder = request.current_holder === ctx.profile.id;
  const isOpen = !['approved', 'rejected', 'reviewed', 'cancelled', 'closed'].includes(request.status);

  useEffect(() => {
    listHistory(request.id).then(setHistory).catch(() => setHistory([]));
    listComments(request.id).then(setComments).catch(() => setComments([]));
    listFieldValues(request.id).then(setFieldValues).catch(() => setFieldValues([]));
  }, [request.id]);

  useEffect(() => {
    if (!forwardQuery.trim()) {
      setForwardResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchForwardTargets(forwardQuery).then(setForwardResults).catch(() => setForwardResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [forwardQuery]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Action failed.'));
      setBusy(false);
    }
  };

  const postComment = async () => {
    if (!commentBody.trim()) return;
    setBusy(true);
    setError('');
    try {
      await addComment(request.id, commentBody.trim(), commentVisibility);
      setCommentBody('');
      setComments(await listComments(request.id));
    } catch (err) {
      setError(errorMessage(err, 'Could not post comment.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={request.title}
      maxWidth="720px"
      footer={
        isHolder && isOpen ? (
          <>
            <button className="btn btn-secondary" onClick={() => setShowForward((v) => !v)} disabled={busy}>
              Forward
            </button>
            {request.decision_mode === 'log_only' ? (
              <button className="btn btn-success" disabled={busy} onClick={() => act(() => decideRequest(request.id, 'reviewed', note))}>
                Mark reviewed
              </button>
            ) : (
              <>
                <button className="btn btn-secondary" disabled={busy} onClick={() => act(() => decideRequest(request.id, 'changes_requested', note))}>
                  Request changes
                </button>
                <button className="btn btn-danger" disabled={busy} onClick={() => act(() => decideRequest(request.id, 'rejected', note))}>
                  Reject
                </button>
                <button className="btn btn-success" disabled={busy} onClick={() => act(() => decideRequest(request.id, 'approved', note))}>
                  Approve
                </button>
              </>
            )}
          </>
        ) : (
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        )
      }
    >
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="detail-grid">
        <div className="detail-row">
          <span className="detail-label">Reference</span>
          <span className="detail-value">{request.reference_number}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Status</span>
          <span><StatusBadge status={request.status} /></span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Category</span>
          <span className="detail-value">{request.request_categories?.name ?? '—'}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Requester</span>
          <span className="detail-value">{request.requester?.full_name ?? '—'}</span>
        </div>
        {fieldValues.map((fv) => (
          <div className="detail-row" key={fv.id}>
            <span className="detail-label">{fv.field_definitions?.label ?? fv.field_definitions?.field_key ?? 'Field'}</span>
            <span className="detail-value">{renderFieldValue(fv.value)}</span>
          </div>
        ))}
      </div>

      {request.body && (
        <div className="form-group">
          <span className="detail-label">Details</span>
          <p style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{request.body}</p>
        </div>
      )}

      {showForward && isHolder && isOpen && (
        <div className="card" style={{ padding: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Forward to</label>
            <input
              className="form-input"
              placeholder="Search by name or email..."
              value={forwardQuery}
              onChange={(e) => setForwardQuery(e.target.value)}
            />
          </div>
          {forwardResults.map((t) => (
            <button
              key={t.user_id}
              className="dropdown-item"
              disabled={busy}
              onClick={() => act(() => forwardRequest(request.id, t.user_id, note))}
            >
              <span>
                <strong>{t.full_name}</strong> <span style={{ color: 'var(--text-muted)' }}>{t.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {isHolder && isOpen && (
        <div className="form-group">
          <label className="form-label">Note (attached to your decision)</label>
          <textarea className="form-input" style={{ minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}

      <div className="form-group">
        <span className="detail-label">Activity</span>
        <div className="timeline">
          {history.length === 0 && <span className="form-hint">No activity recorded.</span>}
          {history.map((h) => (
            <div key={h.id} className="timeline-item">
              <span className="timeline-dot" />
              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', fontWeight: 550, textTransform: 'capitalize' }}>
                  {h.action.replace('_', ' ')}
                </div>
                {h.note && <div style={{ fontSize: '0.825rem' }}>{h.note}</div>}
                <div className="cell-mono">{new Date(h.created_at).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="form-group">
        <span className="detail-label">Comments</span>
        {comments.map((c) => (
          <div key={c.id} style={{ padding: '0.6rem 0.8rem', background: 'var(--surface-alt)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
              <span style={{ fontSize: '0.825rem', whiteSpace: 'pre-wrap' }}>{c.body}</span>
              {c.visibility === 'internal' && <span className="status-badge status-warning">Internal</span>}
            </div>
            <div className="cell-mono">{new Date(c.created_at).toLocaleString()}</div>
          </div>
        ))}
        <div className="repeatable-row" style={{ marginTop: '0.5rem' }}>
          <input
            className="form-input"
            placeholder="Add a comment..."
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
          />
          {/* Students can't author internal comments — a trigger blocks it
              outright (0002), so the control is hidden for them rather than
              offered and then rejected. */}
          {ctx.isStaff && (
            <select
              className="form-input"
              style={{ width: 130 }}
              value={commentVisibility}
              onChange={(e) => setCommentVisibility(e.target.value as 'public' | 'internal')}
            >
              <option value="public">Public</option>
              <option value="internal">Internal</option>
            </select>
          )}
          <button className="btn btn-secondary" onClick={postComment} disabled={busy || !commentBody.trim()}>
            Post
          </button>
        </div>
      </div>
    </Modal>
  );
}
