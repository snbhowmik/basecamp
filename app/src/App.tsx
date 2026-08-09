import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import type { AppView, Profile } from './types';
import { isSetupComplete } from './lib/wizard';
import { getCurrentProfile, signOut } from './lib/auth';
import SetupWizard from './components/wizard/SetupWizard';
import LoginForm from './components/auth/LoginForm';

function App() {
  const [view, setView] = useState<AppView>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    bootstrap();
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

  const handleLogout = async () => {
    await signOut();
    setProfile(null);
    setView('login');
  };

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
          <div className="page-title" style={{ fontSize: '1.1rem' }}>Basecamp</div>
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
              <p className="page-subtitle">Setup is complete. Request flows are the next build phase.</p>
            </div>
          </div>
          <div className="empty-state card">
            <p>Nothing to show yet — this is where request categories and dashboards will live.</p>
          </div>
        </main>
      </div>
    );
  }

  return <LoginForm onLoggedIn={bootstrap} />;
}

export default App;
