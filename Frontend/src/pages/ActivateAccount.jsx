import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../api';

export default function ActivateAccount() {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('Checking activation link...');
  const [error, setError] = useState('');

  useEffect(() => {
    async function activate() {
      if (!token) {
        setError('Missing activation token.');
        setLoading(false);
        setMessage('');
        return;
      }
      try {
        const info = await apiRequest(`/api/auth/activate-account/token-info?token=${encodeURIComponent(token)}`);
        if (!info.valid) {
          setError('This activation link is invalid or has expired.');
          setMessage('');
          setLoading(false);
          return;
        }
        setMessage('Activating your account...');
        const result = await apiRequest('/api/auth/activate-account', {
          method: 'POST',
          body: JSON.stringify({ token }),
        });
        setMessage(result.message || 'Account activated. You can now sign in.');
      } catch (err) {
        setError(err.error || 'Failed to activate account.');
        setMessage('');
      } finally {
        setLoading(false);
      }
    }
    activate();
  }, [token]);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Account activation</h1>
        {message && <p style={styles.subtitle}>{message}</p>}
        {error && <div style={styles.error}>{error}</div>}
        {!loading && (
          <p style={styles.footer}>
            <Link to="/login">Go to sign in</Link>
          </p>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-3)', background: 'var(--color-bg-light)' },
  card: { background: 'var(--color-bg-white)', padding: 'var(--space-5)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', maxWidth: 420, width: '100%' },
  title: { margin: '0 0 var(--space-2)', fontSize: 'var(--text-h3)', fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-charcoal)' },
  subtitle: { margin: '0 0 var(--space-3)', color: 'var(--color-text-steel)', fontSize: 'var(--text-small)' },
  error: { padding: 'var(--space-2)', background: '#FEE2E2', color: 'var(--color-destructive)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-small)' },
  footer: { marginTop: 'var(--space-3)', fontSize: 'var(--text-small)', color: 'var(--color-text-steel)', textAlign: 'center' },
};
