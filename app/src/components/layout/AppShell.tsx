import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  LayoutDashboard, Inbox, UserPlus, Users, GitBranch, LogOut,
  ChevronDown, ChevronsLeft, ChevronsRight, Layers, FileText, Network, LayoutGrid, Settings, X,
} from 'lucide-react';
import type { UserContext } from '../../lib/context';
import Brand from '../ui/Brand';
import { useResolvedTheme } from '../../lib/theme';
import AccountPage from '../pages/AccountPage';
import Modal from '../ui/Modal';

export type Route =
  | '/dashboard'
  | '/hierarchy'
  | '/requests'
  | '/invite'
  | '/accounts'
  | '/workflow'
  | '/levels'
  | '/templates'
  | '/account';

const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';

interface Tab {
  route: Route;
  label: string;
  icon: typeof LayoutDashboard;
  // Read on the mobile launcher, where a destination gets room to say what it
  // is. The rail shows the label alone.
  hint: string;
}

// Nav composition per README.md's V2 notes: the captain runs the platform
// (workflow config, invitations, the account roster); everyone else works
// the queue. This is presentation only — RLS decides what any of these
// pages can actually load.
//
// No "Account" entry: profile/password/MFA/appearance live behind the
// Settings trigger in the sidebar footer now, a floating panel rather than
// a routed destination — one less stop in a list that's supposed to be the
// place you work, not administer yourself.
export function tabsFor(ctx: UserContext): Tab[] {
  if (ctx.isCaptain) {
    return [
      { route: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, hint: 'Accounts, invitations, the shape of the org' },
      { route: '/hierarchy', label: 'Organisation', icon: Network, hint: 'The ladder, and who stands on each rung' },
      { route: '/levels', label: 'Levels', icon: Layers, hint: 'The authority ladder itself' },
      { route: '/workflow', label: 'Workflow', icon: GitBranch, hint: 'Departments, batches and request categories' },
      { route: '/templates', label: 'Templates', icon: FileText, hint: 'Letters generated from a request' },
      { route: '/invite', label: 'Invite', icon: UserPlus, hint: 'Bring somebody into the organisation' },
      { route: '/accounts', label: 'Accounts', icon: Users, hint: 'Everybody with an account' },
    ];
  }
  const tabs: Tab[] = [
    { route: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, hint: 'Your requests and anything waiting on you' },
    { route: '/requests', label: 'Requests', icon: Inbox, hint: 'Raise a request, or work your queue' },
    { route: '/hierarchy', label: 'Organisation', icon: Network, hint: 'The ladder, and who stands on each rung' },
  ];
  // Staff who can invite (anyone above base level) get the invite tab too —
  // can_invite() still decides whether any given invite is permitted.
  if (ctx.isStaff) tabs.push({ route: '/invite', label: 'Invite', icon: UserPlus, hint: 'Bring somebody into the organisation' });
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
  onProfileChanged: () => void;
  children: ReactNode;
}

export default function AppShell({ ctx, route, onNavigate, onLogout, onProfileChanged, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'; } catch { return false; }
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const tabs = tabsFor(ctx);
  const current = tabs.find((t) => t.route === route);
  // The colour mark assumes a white ground (mix-blend-mode: multiply drops
  // its own white box) — on the rail/topbar's dark surface in dark mode
  // that reads as nearly invisible, so swap to the white mark instead.
  const brandVariant = useResolvedTheme() === 'dark' ? 'white' : 'color';

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next)); } catch { /* best effort */ }
      return next;
    });
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <div className="app-container">
      {/* The index rail. A ledger is tabbed down its side, not across its
          head — and a work tool used at a desk should spend horizontal space
          on wayfinding it can keep, rather than a row that has to scroll
          sideways the moment a level is added. */}
      <aside className="rail" data-collapsed={collapsed || undefined}>
        <div className="rail-brand">
          <Brand variant={brandVariant} height={26} />
          {!collapsed && (
            <>
              <span className="brand-divider" aria-hidden="true" />
              <strong>BaseCamp</strong>
            </>
          )}
        </div>

        <nav className="rail-nav" aria-label="Sections">
          {tabs.map(({ route: r, label, icon: Icon }) => (
            <button
              key={r}
              type="button"
              className={`rail-tab ${route === r ? 'active' : ''}`}
              aria-current={route === r ? 'page' : undefined}
              title={collapsed ? label : undefined}
              onClick={() => onNavigate(r)}
            >
              <Icon size={16} aria-hidden="true" />
              {!collapsed && label}
            </button>
          ))}
        </nav>

        <div className="rail-foot">
          <button
            type="button"
            className="rail-tab"
            title={collapsed ? 'Settings' : undefined}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={16} aria-hidden="true" />
            {!collapsed && 'Settings'}
          </button>

          <button type="button" className="rail-collapse" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronsRight size={16} aria-hidden="true" /> : <ChevronsLeft size={16} aria-hidden="true" />}
            {!collapsed && 'Collapse'}
          </button>

          <div className="rail-user" ref={menuRef}>
            <button
              type="button"
              className="user-trigger"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              title={collapsed ? ctx.profile.full_name : undefined}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span className="avatar">{initials(ctx.profile.full_name || '?')}</span>
              {!collapsed && (
                <>
                  <span className="rail-user-name">{ctx.profile.full_name}</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </>
              )}
            </button>
            {menuOpen && (
              <div className="dropdown dropdown--rail" role="menu">
                <div className="dropdown-header">
                  <strong>{ctx.profile.full_name}</strong>
                  <span>{ctx.profile.email}</span>
                </div>
                <button className="dropdown-item danger" role="menuitem" onClick={onLogout}>
                  <LogOut size={16} aria-hidden="true" /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="app-main">
        {/* Mobile letterhead. The rail is gone below 60rem; wayfinding moves
            to the launcher, within thumb reach at the foot of the screen. */}
        <header className="topbar">
          <div className="topbar-brand">
            <Brand variant={brandVariant} height={26} />
            <span className="brand-divider" aria-hidden="true" />
            <strong>BaseCamp</strong>
          </div>
        </header>

        <main className="main-content">{children}</main>
      </div>

      <MobileNav
        tabs={tabs}
        route={route}
        currentLabel={current?.label ?? 'Menu'}
        user={ctx.profile.full_name}
        email={ctx.profile.email}
        onNavigate={onNavigate}
        onLogout={onLogout}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Settings: a floating overlay, not a routed page — see tabsFor's
          comment. Reachable from the rail footer on desktop and the
          launcher's footer on mobile, same trigger either way. */}
      <Modal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings" maxWidth="640px">
        <AccountPage ctx={ctx} onProfileChanged={onProfileChanged} />
      </Modal>
    </div>
  );
}

// The launcher: the hamburger's contents, dealt out as a page of stubs you can
// actually hit with a thumb, plus a dock that reopens it from anywhere. A
// menu that hides behind an icon costs a tap and a guess on every move; this
// costs one tap and shows every destination at once.
function MobileNav({
  tabs, route, currentLabel, user, email, onNavigate, onLogout, onOpenSettings,
}: {
  tabs: Tab[];
  route: Route;
  currentLabel: string;
  user: string;
  email: string;
  onNavigate: (r: Route) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    // The exit animation is collapsed under reduced motion, so waiting for it
    // would just be 240ms of nothing happening.
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setClosing(true);
    window.setTimeout(() => { setClosing(false); setOpen(false); dockRef.current?.focus(); }, still ? 0 : 240);
  }, []);

  useEffect(() => {
    if (!open) return;
    // The page behind must not scroll while the launcher is over it —
    // otherwise a flick meant for the button grid drags the document.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLElement>('button')?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>('button');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const go = (r: Route) => { onNavigate(r); close(); };

  return (
    <>
      <button
        type="button"
        className="launcher-dock"
        ref={dockRef}
        aria-expanded={open}
        aria-controls="launcher-panel"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <LayoutGrid size={17} aria-hidden="true" />
        <span className="launcher-dock-label">{currentLabel}</span>
        <span className="launcher-dock-hint">All sections</span>
      </button>

      {open && (
        <div
          id="launcher-panel"
          className={`launcher ${closing ? 'launcher--closing' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label="Sections"
          ref={panelRef}
        >
          <div className="launcher-head">
            <div>
              <strong>{user}</strong>
              <span>{email}</span>
            </div>
            <button type="button" className="btn-icon" aria-label="Close menu" onClick={close}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="launcher-grid">
            {tabs.map(({ route: r, label, icon: Icon, hint }) => (
              <button
                key={r}
                type="button"
                className={`launcher-item ${route === r ? 'active' : ''}`}
                aria-current={route === r ? 'page' : undefined}
                onClick={() => go(r)}
              >
                <Icon size={19} aria-hidden="true" />
                <span className="launcher-item-label">{label}</span>
                <span className="launcher-item-hint">{hint}</span>
              </button>
            ))}
            <button
              type="button"
              className="launcher-item"
              onClick={() => { close(); onOpenSettings(); }}
            >
              <Settings size={19} aria-hidden="true" />
              <span className="launcher-item-label">Settings</span>
              <span className="launcher-item-hint">Profile, password, authenticator, appearance</span>
            </button>
          </div>

          <button type="button" className="launcher-signout" onClick={onLogout}>
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
    </>
  );
}
