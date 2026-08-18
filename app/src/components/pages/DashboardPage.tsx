import { Fragment, useEffect, useState } from 'react';
import { Clock, CheckCircle2, XCircle, Inbox, Users, MailPlus, ArrowRight } from 'lucide-react';
import type { UserContext } from '../../lib/context';
import { listVisibleRequests, type RequestRow } from '../../lib/requests';
import { listAccounts, type AccountRow } from '../../lib/org';
import { listMyInvites } from '../../lib/invites';
import StatusBadge from '../ui/StatusBadge';
import type { Route } from '../layout/AppShell';

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="stat-card">
      <span className="stat-icon">{icon}</span>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
      </div>
    </div>
  );
}

export default function DashboardPage({ ctx, onNavigate }: { ctx: UserContext; onNavigate: (r: Route) => void }) {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [pendingInvites, setPendingInvites] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        // The captain's dashboard is about the org (who's joined, who's
        // still outstanding); everyone else's is about their own queue.
        if (ctx.isCaptain) {
          const [acc, inv] = await Promise.all([listAccounts(), listMyInvites()]);
          setAccounts(acc);
          setPendingInvites(inv.filter((i) => !i.consumed_at).length);
        } else {
          setRequests(await listVisibleRequests());
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      } finally {
        setLoading(false);
      }
    })();
  }, [ctx.isCaptain]);

  if (loading) return <div className="loading-spinner" style={{ marginTop: '4rem' }} />;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {ctx.isCaptain ? 'Organisation overview' : `Welcome back, ${ctx.profile.full_name.split(' ')[0]}`}
          </h1>
          <p className="page-subtitle">
            {ctx.isCaptain
              ? 'Accounts, invitations, and the shape of the org.'
              : 'Your requests and anything waiting on you.'}
          </p>
        </div>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: '1.25rem' }}>{error}</div>}

      {ctx.isCaptain ? (
        <CaptainDashboard accounts={accounts} pendingInvites={pendingInvites} onNavigate={onNavigate} />
      ) : (
        <MemberDashboard ctx={ctx} requests={requests} onNavigate={onNavigate} />
      )}
    </>
  );
}

function CaptainDashboard({
  accounts,
  pendingInvites,
  onNavigate,
}: {
  accounts: AccountRow[];
  pendingInvites: number;
  onNavigate: (r: Route) => void;
}) {
  // "Important users" = everyone holding a level above base. These are the
  // people who actually run things; students are counted, not listed.
  const staff = accounts.filter((a) => a.tags.some((t) => ['admin', 'dean', 'hod', 'mentor', 'student_outreach'].includes(t)));
  const students = accounts.length - staff.length;

  // A brand-new org is every deployment's first screen, and counters reading
  // 1/1/0/0 answer "how many things exist" when the captain is asking "what
  // do I do now". Until somebody else is in the system, lead with the path
  // instead. Numbered because the order is real — batches need a department,
  // and a Dean needs somewhere to be Dean of.
  const isFreshOrg = accounts.length <= 1 && pendingInvites === 0;

  if (isFreshOrg) {
    return (
      <>
        <ol className="setup-path">
          <li>
            <span className="setup-path__n">1</span>
            <div>
              <strong>Create your departments and batches</strong>
              <p>Students pick these when they register, so nobody can sign up until at least one exists.</p>
              <button className="btn btn-primary btn-sm" onClick={() => onNavigate('/workflow')}>
                Open Workflow <ArrowRight size={14} />
              </button>
            </div>
          </li>
          <li>
            <span className="setup-path__n">2</span>
            <div>
              <strong>Invite the people above department level</strong>
              <p>Deans and HODs. Each invitee gets a link by email and sets their own password and authenticator.</p>
              <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('/invite')}>
                Send an invite <ArrowRight size={14} />
              </button>
            </div>
          </li>
          <li>
            <span className="setup-path__n">3</span>
            <div>
              <strong>They build out the rest</strong>
              <p>An HOD invites their own mentors; students self-register against a department and batch. You do not create those accounts yourself.</p>
            </div>
          </li>
        </ol>

        <div className="card">
          <div className="card-header">
            <h2 className="section-title">Your account</h2>
            <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('/accounts')}>
              View all accounts <ArrowRight size={14} />
            </button>
          </div>
          <div className="card-body">
            <div className="detail-grid">
              {accounts.map((a) => (
                <Fragment key={a.id}>
                  <div className="detail-row">
                    <span className="detail-label">Name</span>
                    <span className="detail-value">{a.full_name}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Email</span>
                    <span className="detail-value cell-mono">{a.email}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Level</span>
                    <span className="detail-value">{a.levelName ?? '—'}</span>
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="stat-grid">
        <StatCard icon={<Users size={19} />} label="Total accounts" value={accounts.length} />
        <StatCard icon={<Users size={19} />} label="Staff & faculty" value={staff.length} />
        <StatCard icon={<Users size={19} />} label="Students" value={students} />
        <StatCard icon={<MailPlus size={19} />} label="Invites pending" value={pendingInvites} />
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="section-title">Staff &amp; faculty</h2>
          <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('/accounts')}>
            View all accounts <ArrowRight size={14} />
          </button>
        </div>
        {staff.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon"><Users size={20} /></span>
            <span className="empty-title">No staff accounts yet</span>
            <span>Invite a Dean or HOD to start building out the org.</span>
            <button className="btn btn-primary btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => onNavigate('/invite')}>
              <MailPlus size={14} /> Send an invite
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Level</th>
                  <th>Tags</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {staff.slice(0, 8).map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="cell-strong">{a.full_name}</div>
                      <div className="cell-mono">{a.email}</div>
                    </td>
                    <td>{a.levelName ?? <span className="detail-value empty">—</span>}</td>
                    <td>
                      <div className="chip-list">
                        {a.tags.filter((t) => !t.startsWith('dept:') && !t.startsWith('class:')).map((t) => (
                          <span key={t} className="chip">{t}</span>
                        ))}
                      </div>
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

function MemberDashboard({
  ctx,
  requests,
  onNavigate,
}: {
  ctx: UserContext;
  requests: RequestRow[];
  onNavigate: (r: Route) => void;
}) {
  const mine = requests.filter((r) => r.requested_by === ctx.profile.id);
  const onMyDesk = requests.filter((r) => r.current_holder === ctx.profile.id);

  const pending = mine.filter((r) => ['submitted', 'in_review'].includes(r.status)).length;
  const approved = mine.filter((r) => ['approved', 'reviewed'].includes(r.status)).length;
  const rejected = mine.filter((r) => r.status === 'rejected').length;
  const changes = mine.filter((r) => r.status === 'changes_requested').length;

  return (
    <>
      <div className="stat-grid">
        <StatCard icon={<Clock size={19} />} label="Pending" value={pending} />
        <StatCard icon={<CheckCircle2 size={19} />} label="Approved" value={approved} />
        <StatCard icon={<XCircle size={19} />} label="Rejected" value={rejected} />
        {ctx.isStaff ? (
          <StatCard icon={<Inbox size={19} />} label="Awaiting my action" value={onMyDesk.length} />
        ) : (
          <StatCard icon={<Inbox size={19} />} label="Needs changes" value={changes} />
        )}
      </div>

      <div className="grid-2">
        {ctx.isStaff && (
          <div className="card">
            <div className="card-header">
              <h2 className="section-title">Awaiting your action</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('/requests')}>
                Open queue <ArrowRight size={14} />
              </button>
            </div>
            {onMyDesk.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon"><Inbox size={20} /></span>
                <span className="empty-title">Nothing waiting on you</span>
                <span>Requests forwarded to you will appear here.</span>
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr><th>Request</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {onMyDesk.slice(0, 6).map((r) => (
                      <tr key={r.id} className="clickable" onClick={() => onNavigate('/requests')}>
                        <td>
                          <div className="cell-strong">{r.title}</div>
                          <div className="cell-mono">{r.reference_number}</div>
                        </td>
                        <td><StatusBadge status={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="card">
          <div className="card-header">
            <h2 className="section-title">My recent requests</h2>
            <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('/requests')}>
              View all <ArrowRight size={14} />
            </button>
          </div>
          {mine.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon"><Inbox size={20} /></span>
              <span className="empty-title">No requests yet</span>
              <span>Raise your first request to get started.</span>
              <button className="btn btn-primary btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => onNavigate('/requests')}>
                New request
              </button>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>Request</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {mine.slice(0, 6).map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => onNavigate('/requests')}>
                      <td>
                        <div className="cell-strong">{r.title}</div>
                        <div className="cell-mono">{r.reference_number}</div>
                      </td>
                      <td><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
