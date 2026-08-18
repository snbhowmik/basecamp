import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LayoutDashboard, Inbox, UserPlus, Users, GitBranch, UserCircle, LogOut, ChevronDown } from 'lucide-react';
import type { UserContext } from '../../lib/context';
import Brand from '../ui/Brand';

export type Route =
  | '/dashboard'
  | '/requests'
  | '/invite'
  | '/accounts'
  | '/workflow'
  | '/account';

interface Tab {
  route: Route;
  label: string;
  icon: typeof LayoutDashboard;
}

// Nav composition per README.md's V2 notes: the captain runs the platform
// (workflow config, invitations, the account roster); everyone else works
// the queue. This is presentation only — RLS decides what any of these
// pages can actually load.
export function tabsFor(ctx: UserContext): Tab[] {
  if (ctx.isCaptain) {
    return [
      { route: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { route: '/workflow', label: 'Workflow', icon: GitBranch },
      { route: '/invite', label: 'Invite', icon: UserPlus },
      { route: '/accounts', label: 'Accounts', icon: Users },
    ];
  }
  const tabs: Tab[] = [
    { route: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { route: '/requests', label: 'Requests', icon: Inbox },
  ];
  // Staff who can invite (anyone above base level) get the invite tab too —
  // can_invite() still decides whether any given invite is permitted.
  if (ctx.isStaff) tabs.push({ route: '/invite', label: 'Invite', icon: UserPlus });
  tabs.push({ route: '/account', label: 'Account', icon: UserCircle });
  return tabs;
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

interface AppShellProps {
  ctx: UserContext;
  route: Route;
  onNavigate: (route: Route) => void;
  onLogout: () => void;
  children: ReactNode;
}

export default function AppShell({ ctx, route, onNavigate, onLogout, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const tabs = tabsFor(ctx);

  return (
    <div className="app-container">
      <header className="topbar">
        {/* The mark identifies the organisation; the product is always
            BaseCamp. Once organisations are configurable this logo and
            the org name become instance settings — the wordmark does not. */}
        <div className="topbar-brand">
          <Brand height={28} />
          <span className="brand-divider" aria-hidden="true" />
          <strong>BaseCamp</strong>
        </div>

        <nav className="nav-tabs">
          {tabs.map(({ route: r, label, icon: Icon }) => (
            <button
              key={r}
              className={`nav-tab ${route === r ? 'active' : ''}`}
              onClick={() => onNavigate(r)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>

        <div className="topbar-user" ref={menuRef}>
          <button className="user-trigger" onClick={() => setMenuOpen((v) => !v)}>
            <span className="avatar">{initials(ctx.profile.full_name || '?')}</span>
            <ChevronDown size={14} />
          </button>
          {menuOpen && (
            <div className="dropdown">
              <div className="dropdown-header">
                <strong>{ctx.profile.full_name}</strong>
                <span>{ctx.profile.email}</span>
              </div>
              <button className="dropdown-item" onClick={() => { setMenuOpen(false); onNavigate('/account'); }}>
                <UserCircle size={16} /> My account
              </button>
              <button className="dropdown-item danger" onClick={onLogout}>
                <LogOut size={16} /> Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="main-content">{children}</main>
    </div>
  );
}
