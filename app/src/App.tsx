import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import type { AppView, Profile } from './types';
import { isSetupComplete } from './lib/wizard';
import { getCurrentProfile, signOut } from './lib/auth';
import SetupWizard from './components/wizard/SetupWizard';
import LoginForm from './components/auth/LoginForm';
import RegisterForm from './components/auth/RegisterForm';
import AcceptInvite from './components/auth/AcceptInvite';
import InvitePanel from './components/admin/InvitePanel';

// No router library — only two extra paths exist right now
// (/register, /invite/<token>), both reachable pre-auth, both bypassing
// the normal wizard/login bootstrap entirely. Revisit with a real router
// once there's enough surface area (dashboard sub-pages) to justify it —
// see README.md V2 nav notes.
function matchInviteToken(pathname: string): string | null {
  const m = pathname.match(/^\/invite\/([^/]+)$/);
  return m ? m[1] : null;
}

function App() {
  const [view, setView] = useState<AppView | 'register' | 'invite'>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);
  const inviteToken = matchInviteToken(window.location.pathname);

  useEffect(() => {
    if (inviteToken) {
      setView('invite');
      return;
    }
    if (window.location.pathname === '/register') {
      setView('register');
      return;
    }
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bootstrap = async () => {
    try {
      const setupDone = await isSetupComplete();
      if (!setupDone) {
        setView('wizard');
        return;
      }
      const p = await getCurrentProfile();
      if (p) {
        setProfile(p);
        setView('dashboard');
      } else {
        setView('login');
      }
    } catch {
      setView('login');
    }
  };

  const goHome = () => {
    window.history.pushState({}, '', '/');
    bootstrap();
  };

  const handleLogout = async () => {
    await signOut();
    setProfile(null);
    setView('login');
  };

  if (view === 'invite' && inviteToken) {
    return <AcceptInvite token={inviteToken} onDone={goHome} />;
  }

  if (view === 'register') {
    return <RegisterForm onDone={goHome} onSwitchToLogin={goHome} />;
  }

  if (view === 'loading') {
    return (
      <div className="auth-wrapper" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (view === 'wizard') {
    return <SetupWizard onComplete={() => window.location.reload()} />;
  }

  if (view === 'dashboard' && profile) {
    return (
      <div className="app-container">
        <nav className="navbar" style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem 2rem', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          <div className="page-title" style={{ fontSize: '1.1rem' }}>SRMIST BaseCamp</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{profile.full_name}</span>
            <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
              <LogOut size={14} /> Log out
            </button>
          </div>
        </nav>
        <main className="main-content">
          <div className="page-header">
            <div>
              <h1 className="page-title">Welcome, {profile.full_name}</h1>
              <p className="page-subtitle">
                Invite people into the org below — Dean, HOD, Mentor, Student, whatever you're entitled to.
                Request flows are the next build phase.
              </p>
            </div>
          </div>
          <InvitePanel />
        </main>
      </div>
    );
  }

  return <LoginForm onLoggedIn={bootstrap} onSwitchToRegister={() => { window.history.pushState({}, '', '/register'); setView('register'); }} />;
}

export default App;
