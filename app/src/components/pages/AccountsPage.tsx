import { useEffect, useMemo, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { listAccounts, type AccountRow } from '../../lib/org';

// The captain's roster of every account on the instance. Read-only for now —
// deactivating or re-leveling someone is V3 (TASK.md).
export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    listAccounts()
      .then(setAccounts)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load accounts.'))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    if (!query.trim()) return accounts;
    const q = query.toLowerCase();
    return accounts.filter(
      (a) =>
        a.full_name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.tags.some((t) => t.includes(q)),
    );
  }, [accounts, query]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Accounts</h1>
          <p className="page-subtitle">Everyone with an account on this instance.</p>
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: '1.25rem' }}>{error}</div>}

      <div className="card">
        <div className="toolbar">
          <span className="form-hint">{visible.length} of {accounts.length} accounts</span>
          <div style={{ position: 'relative', minWidth: 240 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="form-input"
              style={{ paddingLeft: '2rem' }}
              placeholder="Search name, email, or tag..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '3rem' }}><div className="loading-spinner" /></div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon"><Users size={20} /></span>
            <span className="empty-title">No accounts found</span>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Level</th>
                  <th>Tags</th>
                  <th>MFA</th>
                  <th>Status</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="cell-strong">{a.full_name}</div>
                      <div className="cell-mono">{a.email}</div>
                    </td>
                    <td>{a.levelNames.length > 0 ? a.levelNames.join(', ') : <span className="detail-value empty">—</span>}</td>
                    <td>
                      <div className="chip-list">
                        {a.tags.length === 0 && <span className="detail-value empty">—</span>}
                        {a.tags.map((t) => <span key={t} className="chip">{t}</span>)}
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${a.mfa_enrolled ? 'status-success' : 'status-warning'}`}>
                        {a.mfa_enrolled ? 'Enrolled' : 'Pending'}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${a.is_active ? 'status-success' : 'status-neutral'}`}>
                        {a.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="cell-mono">{new Date(a.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
