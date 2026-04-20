import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../api';
import { applicationInitials } from '../utils/applicationInitials';
import { resolveIconSrc } from '../utils/resolveIconSrc';

export default function Dashboard() {
  const { user, token, logout } = useAuth();
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [redirecting, setRedirecting] = useState(null);

  useEffect(() => {
    apiRequest('/api/applications/for-me', {}, token)
      .then((data) => setApplications(data.applications || []))
      .catch((err) => setError(err.error || 'Failed to load applications'))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleAppClick(app) {
    setRedirecting(app.id);
    setError('');
    try {
      const { bridgeUrl } = await apiRequest(
        `/api/sso/redirect?applicationId=${encodeURIComponent(app.id)}`,
        {},
        token
      );
      // Do not pass noopener in open() — with noopener many browsers return null even when the tab opens,
      // which falsely looked like "popup blocked". Open first, then drop opener reference.
      const newTab = window.open(bridgeUrl, '_blank');
      if (newTab) {
        try {
          newTab.opener = null;
        } catch {
          /* ignore */
        }
      } else {
        window.location.href = bridgeUrl;
      }
      setRedirecting(null);
    } catch (err) {
      setError(err.error || 'Redirect failed');
      setRedirecting(null);
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>Downstream Hub</h1>
        <div style={styles.userRow}>
          <span style={styles.userEmail}>{user?.email}</span>
          {user?.business_unit_name != null && user.business_unit_name !== '' && (
            <span style={styles.userBu}>BU: {user.business_unit_name}</span>
          )}
          {user?.role === 'Admin' && (
            <Link to="/admin" style={styles.adminLink}>Admin</Link>
          )}
          <Link to="/change-password" style={styles.adminLink}>Change password</Link>
          <button type="button" onClick={logout} className="btn-secondary" style={styles.logoutBtn}>Sign out</button>
        </div>
      </header>
      <main style={styles.main}>
        <p style={styles.subtitle}>Single source of truth for internal tools — click an app to open it with SSO.</p>
        {error && <div style={styles.error}>{error}</div>}
        {loading ? (
          <p>Loading applications…</p>
        ) : applications.length === 0 ? (
          <p style={styles.empty}>No applications yet. {user?.role === 'Admin' && 'Add some in Admin.'}</p>
        ) : (
          <div style={styles.grid}>
            {applications.map((app) => {
              const iconSrc = resolveIconSrc(app.icon_url);
              return (
              <button
                key={app.id}
                type="button"
                style={styles.card}
                onClick={() => handleAppClick(app)}
                disabled={!!redirecting}
              >
                <div style={styles.cardIcon}>
                  {iconSrc ? (
                    <img src={iconSrc} alt="" style={styles.iconImg} />
                  ) : (
                    <span style={styles.iconInitials} title={app.name}>
                      {applicationInitials(app.name)}
                    </span>
                  )}
                </div>
                <div style={styles.cardName}>{app.name}</div>
                {app.description && <div style={styles.cardDesc}>{app.description}</div>}
                {redirecting === app.id && <div style={styles.redirecting}>Opening…</div>}
              </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: 'var(--color-bg-light)' },
  header: { background: 'var(--color-bg-white)', padding: 'var(--space-3) var(--space-4)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' },
  title: { margin: 0, fontSize: 'var(--text-h3)', fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-charcoal)' },
  userRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' },
  userEmail: { fontSize: 'var(--text-small)', color: 'var(--color-text-steel)' },
  userBu: { fontSize: 'var(--text-small)', color: 'var(--color-text-steel)', fontStyle: 'italic' },
  adminLink: { color: 'var(--color-primary)', textDecoration: 'none', fontSize: 'var(--text-small)', fontWeight: 'var(--font-weight-medium)' },
  logoutBtn: {},
  main: { maxWidth: 960, margin: '0 auto', padding: 'var(--space-4)' },
  subtitle: { color: 'var(--color-text-steel)', marginBottom: 'var(--space-4)', fontSize: 'var(--text-small)' },
  error: { padding: 'var(--space-3)', background: '#FEE2E2', color: 'var(--color-destructive)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-3)', fontSize: 'var(--text-small)' },
  empty: { color: 'var(--color-text-steel)', fontSize: 'var(--text-small)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--space-3)' },
  card: { background: 'var(--color-bg-white)', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', textAlign: 'center', cursor: 'pointer', boxShadow: 'var(--shadow-sm)', position: 'relative', transition: 'border-color var(--duration-fast) var(--easing-default)' },
  cardIcon: { width: 48, height: 48, margin: '0 auto var(--space-3)', borderRadius: '12px', overflow: 'hidden', background: 'var(--color-bg-lighter)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  iconImg: { width: '100%', height: '100%', objectFit: 'cover' },
  iconInitials: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#A84335',
    color: '#fff',
    fontWeight: 700,
    fontSize: '13px',
    letterSpacing: '0.04em',
    fontFamily: 'var(--font-heading, system-ui, sans-serif)',
  },
  cardName: { fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--space-1)', color: 'var(--color-text-charcoal)' },
  cardDesc: { fontSize: 'var(--text-xs)', color: 'var(--color-text-steel)', lineHeight: 'var(--line-height-default)' },
  redirecting: { marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-primary)' },
};
