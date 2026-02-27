import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../api';

export default function ChangePassword() {
  const { user, token, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordRetype, setNewPasswordRetype] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(false);
    if (newPassword !== newPasswordRetype) {
      setError('New password and confirm do not match');
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          new_password_retype: newPasswordRetype,
        }),
      }, token);
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordRetype('');
    } catch (err) {
      setError(err.error || 'Failed to update password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Change password</h1>
        <p style={styles.subtitle}>Signed in as {user?.email}</p>
        {success ? (
          <p style={styles.success}>Password updated successfully.</p>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form}>
            {error && <div style={styles.error}>{error}</div>}
            <input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={styles.input}
            />
            <input
              type="password"
              placeholder="New password (min 6 characters)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              style={styles.input}
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={newPasswordRetype}
              onChange={(e) => setNewPasswordRetype(e.target.value)}
              required
              autoComplete="new-password"
              style={styles.input}
            />
            <button type="submit" disabled={submitting} className="btn-primary" style={styles.button}>
              {submitting ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
        <p style={styles.footer}>
          <Link to="/">Dashboard</Link>
          {' · '}
          <button type="button" onClick={logout} style={styles.linkBtn}>Sign out</button>
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
  error: { padding: 'var(--space-2)', background: '#FEE2E2', color: 'var(--color-destructive)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-small)' },
  success: { padding: 'var(--space-2)', background: '#D1FAE5', color: 'var(--color-text-charcoal)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-small)' },
  input: { padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--color-border-medium)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-base)' },
  button: {},
  footer: { marginTop: 'var(--space-3)', fontSize: 'var(--text-small)', color: 'var(--color-text-steel)', textAlign: 'center' },
  linkBtn: { background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', padding: 0, fontSize: 'inherit' },
};
