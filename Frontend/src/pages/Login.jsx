import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../api';

export default function Login() {
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [mfaChallenge, setMfaChallenge] = useState(null);
  const [otp, setOtp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const successMessage = location.state?.message;

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const token = params.get('sso_verify');
    if (!token) return;
    const applicationId = params.get('application_id');
    let ignore = false;
    (async () => {
      try {
        const q = `token=${encodeURIComponent(token)}${applicationId ? `&application_id=${encodeURIComponent(applicationId)}` : ''}`;
        const data = await apiRequest(`/api/auth/oidc/auto-link/verify?${q}`);
        if (!ignore) setError(data.message === 'linked' ? '' : 'Failed to verify SSO link');
      } catch (err) {
        if (!ignore) setError(err.error || 'SSO link verification failed');
      }
    })();
    return () => {
      ignore = true;
    };
  }, [location.search]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result?.mfa_required) {
        setMfaChallenge(result);
        setError('');
        return;
      }
      navigate('/', { replace: true });
    } catch (err) {
      if (err.code === 'PASSWORD_EXPIRED') {
        navigate('/change-password-expired', { state: { email }, replace: true });
        return;
      }
      if (err.status === 423 && err.code === 'ACCOUNT_LOCKED') {
        const until = err.locked_until ? new Date(err.locked_until).toLocaleString() : '';
        setError(err.error ? `${err.error} Try again after ${until || 'the lockout period'} or contact an administrator.` : 'Account locked. Try again later or contact an administrator.');
        return;
      }
      setError(err.error || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfaSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await verifyMfa(mfaChallenge?.challenge_id, otp);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.error || 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Downstream Hub</h1>
        <p style={styles.subtitle}>Sign in to access your tools</p>
        {!mfaChallenge ? (
        <form onSubmit={handleSubmit} style={styles.form}>
          {successMessage && <div style={styles.success}>{successMessage}</div>}
          {error && <div style={styles.error}>{error}</div>}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={styles.input}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={styles.input}
          />
          <button type="submit" disabled={submitting} className="btn-primary" style={styles.button}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        ) : (
        <form onSubmit={handleMfaSubmit} style={styles.form}>
          <div style={styles.success}>Verification code sent to your email.</div>
          {error && <div style={styles.error}>{error}</div>}
          <input
            type="text"
            placeholder="6-digit verification code"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            required
            style={styles.input}
          />
          <button type="submit" disabled={submitting} className="btn-primary" style={styles.button}>
            {submitting ? 'Verifying…' : 'Verify and continue'}
          </button>
        </form>
        )}
        <p style={styles.footer}>
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
        <p style={styles.footer}>
          Don’t have an account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-3)', background: 'var(--color-bg-light)' },
  card: { background: 'var(--color-bg-white)', padding: 'var(--space-5)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', maxWidth: 360, width: '100%' },
  title: { margin: '0 0 var(--space-1)', fontSize: 'var(--text-h3)', fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-charcoal)' },
  subtitle: { margin: '0 0 var(--space-4)', color: 'var(--color-text-steel)', fontSize: 'var(--text-small)' },
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' },
  success: { padding: 'var(--space-2)', background: '#D1FAE5', color: 'var(--color-text-charcoal)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-small)' },
  error: { padding: 'var(--space-2)', background: '#FEE2E2', color: 'var(--color-destructive)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-small)' },
  input: { padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--color-border-medium)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-base)' },
  button: {},
  footer: { marginTop: 'var(--space-3)', fontSize: 'var(--text-small)', color: 'var(--color-text-steel)', textAlign: 'center' },
};
