import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const successMessage = location.state?.message;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      if (err.code === 'PASSWORD_EXPIRED') {
        navigate('/change-password-expired', { state: { email }, replace: true });
        return;
      }
      setError(err.error || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Downstream Hub</h1>
        <p style={styles.subtitle}>Sign in to access your tools</p>
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
