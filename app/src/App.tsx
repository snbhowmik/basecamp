import { useCallback, useEffect, useState } from 'react';
import { isSetupComplete } from './lib/wizard';
import { signOut } from './lib/auth';
import { loadUserContext, type UserContext } from './lib/context';
import SetupWizard from './components/wizard/SetupWizard';
import LoginForm from './components/auth/LoginForm';
import RegisterForm from './components/auth/RegisterForm';
import AcceptInvite from './components/auth/AcceptInvite';
import AppShell, { tabsFor, type Route } from './components/layout/AppShell';
import DashboardPage from './components/pages/DashboardPage';
import RequestsPage from './components/pages/RequestsPage';
import AccountPage from './components/pages/AccountPage';
import AccountsPage from './components/pages/AccountsPage';
import WorkflowPage from './components/pages/WorkflowPage';
import InvitePanel from './components/admin/InvitePanel';

type Screen = 'loading' | 'wizard' | 'login' | 'register' | 'invite' | 'app';

// Minimal path routing — no router dependency for a handful of flat routes.
// nginx/frontend.conf serves index.html for all of them so a direct visit
// (an emailed /invite/<token> link, a bookmarked /requests) resolves.
function inviteTokenFrom(pathname: string): string | null {
  const m = pathname.match(/^\/invite\/([^/]+)$/);
  return m ? m[1] : null;
}

function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [ctx, setCtx] = useState<UserContext | null>(null);
  const [route, setRoute] = useState<Route>('/dashboard');
  const inviteToken = inviteTokenFrom(window.location.pathname);

  const bootstrap = useCallback(async () => {
    try {
      if (!(await isSetupComplete())) {
        setScreen('wizard');
        return;
      }
      const loaded = await loadUserContext();
      if (!loaded) {
        setScreen('login');
        return;
      }
      setCtx(loaded);
      // Land on a tab this user actually has. Someone deep-linking to
      // /workflow without the captain tag gets their own first tab instead
      // of an empty screen — the page's queries would be denied by RLS
      // anyway, this just avoids showing a broken one.
      const allowed = tabsFor(loaded).map((t) => t.route);
      const fromPath = window.location.pathname as Route;
      setRoute(allowed.includes(fromPath) ? fromPath : allowed[0]);
      setScreen('app');
    } catch {
      setScreen('login');
    }
  }, []);

  useEffect(() => {
    if (inviteToken) {
      setScreen('invite');
      return;
    }
    if (window.location.pathname === '/register') {
      setScreen('register');
      return;
    }
    bootstrap();
  }, [bootstrap, inviteToken]);

  useEffect(() => {
    const onPop = () => {
      const p = window.location.pathname;
      if (inviteTokenFrom(p) || p === '/register') {
        window.location.reload();
        return;
      }
      setRoute(p as Route);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (r: Route) => {
    window.history.pushState({}, '', r);
    setRoute(r);
  };

  const goHome = () => {
    window.history.pushState({}, '', '/');
    bootstrap();
  };

  const handleLogout = async () => {
    await signOut();
    setCtx(null);
    window.history.pushState({}, '', '/');
    setScreen('login');
  };

  if (screen === 'invite' && inviteToken) return <AcceptInvite token={inviteToken} onDone={goHome} />;
  if (screen === 'register') return <RegisterForm onDone={goHome} onSwitchToLogin={goHome} />;
  if (screen === 'wizard') return <SetupWizard onComplete={() => window.location.reload()} />;

  if (screen === 'loading') {
    return (
      <div className="auth-wrapper" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (screen === 'app' && ctx) {
    return (
      <AppShell ctx={ctx} route={route} onNavigate={navigate} onLogout={handleLogout}>
        {route === '/dashboard' && <DashboardPage ctx={ctx} onNavigate={navigate} />}
        {route === '/requests' && <RequestsPage ctx={ctx} />}
        {route === '/invite' && <InvitePanel />}
        {route === '/accounts' && <AccountsPage />}
        {route === '/workflow' && <WorkflowPage />}
        {route === '/account' && <AccountPage ctx={ctx} onProfileChanged={bootstrap} />}
      </AppShell>
    );
  }

  return (
    <LoginForm
      onLoggedIn={bootstrap}
      onSwitchToRegister={() => {
        window.history.pushState({}, '', '/register');
        setScreen('register');
      }}
    />
  );
}

export default App;
