import { errorMessage } from '../../lib/errors';
import { useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { signIn } from '../../lib/auth';
import Brand from '../ui/Brand';
import { useMediaQuery, AUTH_PANEL_QUERY } from '../../lib/useMediaQuery';

interface LoginFormProps {
  onLoggedIn: () => void;
  onSwitchToRegister: () => void;
}

export default function LoginForm({ onLoggedIn, onSwitchToRegister }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);

      const { data: factors, error: factorsErr } = await supabase.auth.mfa.listFactors();
      if (factorsErr) throw factorsErr;
      const totp = factors.totp.find((f) => f.status === 'verified');

      if (!totp) {
        // Schema requires MFA for every account; a verified user with no
        // factor means enrollment was interrupted — send them to enroll.
        setError('MFA is not enrolled on this account. Contact an admin.');
        return;
      }

      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === 'aal2') {
        onLoggedIn();
        return;
      }

      setFactorId(totp.id);
    } catch (err) {
      setError(errorMessage(err, 'Login failed.'));
    } finally {
      setLoading(false);
    }
  };

  const handleTotpSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!factorId) return;
    setError('');
    setLoading(true);
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error) throw challenge.error;
      const verify = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code: totpCode,
      });
      if (verify.error) throw verify.error;
      onLoggedIn();
    } catch (err) {
      setError(errorMessage(err, 'Verification failed.'));
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
            <h1 className="auth-title">{factorId ? 'Verify your identity' : 'Welcome back'}</h1>
            <p className="auth-subtitle">
              {factorId ? 'Enter the 6-digit code from your authenticator app.' : 'Sign in to continue.'}
            </p>
          </div>

          {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}

          {!factorId ? (
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
          ) : (
            <form onSubmit={handleTotpSubmit} className="auth-form">
              <div className="form-group">
                <label className="form-label">6-digit code</label>
                <input
                  className="form-input"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Verifying...' : 'Verify'} <ArrowRight size={18} />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
