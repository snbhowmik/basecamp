import { errorMessage } from '../../lib/errors';
import { useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { signIn } from '../../lib/auth';
import Brand from '../ui/Brand';
import { useMediaQuery, AUTH_PANEL_QUERY } from '../../lib/useMediaQuery';

interface LoginFormProps {
  onLoggedIn: () => void;
  onSwitchToRegister: () => void;
}

// Password entry only. The second factor is NOT handled here.
//
// It used to be: this component signed in, then held the TOTP step in local
// state and called onLoggedIn() only after verification. But signInWithPassword
// has already written a real aal1 session to localStorage by then, so the
// "gate" survived exactly as long as the component did. A refresh re-entered
// through App.tsx's bootstrap, which never looked at the assurance level, and
// the password alone was enough to use the app.
//
// The step-up now lives in a screen that bootstrap() routes to on every load
// (components/auth/VerifyMfa.tsx), so there is one gate and it is evaluated
// from the session rather than from component state. Signing in here simply
// hands control back; whether that lands in the app or on the verify screen is
// bootstrap's decision, not this form's.
export default function LoginForm({ onLoggedIn, onSwitchToRegister }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      onLoggedIn();
    } catch (err) {
      setError(errorMessage(err, 'Login failed.'));
    } finally {
      setLoading(false);
    }
  };

  const wideEnoughForPanel = useMediaQuery(AUTH_PANEL_QUERY);

  return (
    <div className="auth-wrapper">
      <div className="auth-side">
        <div className="bg-pattern" />
        <div className="auth-side-content">
          <h2>BaseCamp</h2>
          <p>A request and ticketing platform. Track less. Manage better — built for your organisation.</p>
        </div>
        <div className="auth-side-mark">
          <Brand variant="white" height={58} />
        </div>
      </div>
      <div className="auth-content">
        <div className="auth-card">
          <div className="auth-header">
            {/* Only rendered below the panel breakpoint. On desktop the
                blue panel already carries the mark, so this one is not
                merely hidden — it is never requested. */}
            {!wideEnoughForPanel && (
              <div className="auth-logo"><Brand height={34} /></div>
            )}
            <h1 className="auth-title">Welcome back</h1>
            <p className="auth-subtitle">Sign in to continue.</p>
          </div>

          {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}

          <form onSubmit={handlePasswordSubmit} className="auth-form">
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'} <ArrowRight size={18} />
            </button>
            <div className="auth-footer" style={{ marginTop: 0 }}>
              Student? <button type="button" className="auth-link" onClick={onSwitchToRegister}>Register here</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
