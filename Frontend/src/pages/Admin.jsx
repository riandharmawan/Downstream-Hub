import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../api';

const SECTIONS = [
  { id: 'domains', label: 'Domains', path: 'domains' },
  { id: 'business-units', label: 'Business Units', path: 'business-units' },
  { id: 'users', label: 'Users', path: 'users' },
  { id: 'applications', label: 'Applications', path: 'applications' },
  { id: 'password-policy', label: 'Password policy', path: 'password-policy' },
];

export default function Admin() {
  const { user, token, logout } = useAuth();
  const { section } = useParams();
  const navigate = useNavigate();
  const activeSection = SECTIONS.some((s) => s.path === section) ? section : null;
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', icon_url: '', target_url: '', target_bu_id: '' });
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [domainsLoading, setDomainsLoading] = useState(true);
  const [domains, setDomains] = useState([]);
  const [domainForm, setDomainForm] = useState({ domain: '' });
  const [showDomainForm, setShowDomainForm] = useState(false);
  const [editingDomain, setEditingDomain] = useState(null);
  const [domainDeleteConfirm, setDomainDeleteConfirm] = useState(null);
  const [domainSaving, setDomainSaving] = useState(false);
  const [businessUnits, setBusinessUnits] = useState([]);
  const [busLoading, setBusLoading] = useState(true);
  const [buForm, setBuForm] = useState({ name: '' });
  const [showBuForm, setShowBuForm] = useState(false);
  const [editingBu, setEditingBu] = useState(null);
  const [buDeleteConfirm, setBuDeleteConfirm] = useState(null);
  const [buSaving, setBuSaving] = useState(false);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [userEditBu, setUserEditBu] = useState(null);
  const [userBuForm, setUserBuForm] = useState('');
  const [userBuSaving, setUserBuSaving] = useState(false);
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [addUserForm, setAddUserForm] = useState({ email: '', password: '', password_retype: '', role: 'Employee', business_unit_id: '' });
  const [addUserSaving, setAddUserSaving] = useState(false);
  const [userDeactivateConfirm, setUserDeactivateConfirm] = useState(null);
  const [resetPasswordResult, setResetPasswordResult] = useState(null);
  const [passwordExpiryDays, setPasswordExpiryDays] = useState(0);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policySaving, setPolicySaving] = useState(false);

  useEffect(() => {
    if (user?.role !== 'Admin') return;
    apiRequest('/api/applications', {}, token)
      .then((data) => setApplications(data.applications || []))
      .catch((err) => setError(err.error || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token, user?.role]);

  useEffect(() => {
    if (user?.role !== 'Admin') return;
    apiRequest('/api/allowed-domains', {}, token)
      .then((data) => setDomains(data.allowed_domains || []))
      .catch(() => setDomains([]))
      .finally(() => setDomainsLoading(false));
  }, [token, user?.role]);

  useEffect(() => {
    if (user?.role !== 'Admin') return;
    apiRequest('/api/business-units', {}, token)
      .then((data) => setBusinessUnits(data.business_units || []))
      .catch(() => setBusinessUnits([]))
      .finally(() => setBusLoading(false));
  }, [token, user?.role]);

  useEffect(() => {
    if (user?.role !== 'Admin') return;
    apiRequest('/api/users', {}, token)
      .then((data) => setUsers(data.users || []))
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false));
  }, [token, user?.role]);

  useEffect(() => {
    if (user?.role !== 'Admin') return;
    apiRequest('/api/settings/password-policy', {}, token)
      .then((data) => setPasswordExpiryDays(data.password_expiry_days ?? 0))
      .catch(() => setPasswordExpiryDays(0))
      .finally(() => setPolicyLoading(false));
  }, [token, user?.role]);

  async function handleSavePasswordPolicy(e) {
    e.preventDefault();
    setError('');
    setPolicySaving(true);
    try {
      const days = Math.max(0, Math.min(365, parseInt(String(passwordExpiryDays), 10) || 0));
      await apiRequest('/api/settings/password-policy', {
        method: 'PUT',
        body: JSON.stringify({ password_expiry_days: days }),
      }, token);
      setPasswordExpiryDays(days);
    } catch (err) {
      setError(err.error || 'Failed to save');
    } finally {
      setPolicySaving(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({ name: '', description: '', icon_url: '', target_url: '', target_bu_id: '' });
    setShowForm(true);
  }

  function openEdit(app) {
    setEditing(app);
    setForm({
      name: app.name,
      description: app.description || '',
      icon_url: app.icon_url || '',
      target_url: app.target_url || '',
      target_bu_id: app.target_bu_id || '',
    });
    setShowForm(true);
  }

  async function loadDomains() {
    const data = await apiRequest('/api/allowed-domains', {}, token);
    setDomains(data.allowed_domains || []);
  }

  function openAddDomain() {
    setEditingDomain(null);
    setDomainForm({ domain: '' });
    setShowDomainForm(true);
  }

  function openEditDomain(row) {
    setEditingDomain(row);
    setDomainForm({ domain: row.domain });
    setShowDomainForm(true);
  }

  async function handleSaveDomain(e) {
    e.preventDefault();
    setError('');
    setDomainSaving(true);
    try {
      const domain = (domainForm.domain || '').trim().toLowerCase().replace(/^@+/, '');
      if (!domain) {
        setError('Domain is required (e.g. example.com)');
        setDomainSaving(false);
        return;
      }
      if (editingDomain) {
        await apiRequest(`/api/allowed-domains/${editingDomain.id}`, {
          method: 'PUT',
          body: JSON.stringify({ domain }),
        }, token);
      } else {
        await apiRequest('/api/allowed-domains', {
          method: 'POST',
          body: JSON.stringify({ domain }),
        }, token);
      }
      await loadDomains();
      setShowDomainForm(false);
      setEditingDomain(null);
      setDomainForm({ domain: '' });
    } catch (err) {
      setError(err.error || 'Save failed');
    } finally {
      setDomainSaving(false);
    }
  }

  async function handleDeleteDomain(row) {
    setError('');
    setDomainSaving(true);
    try {
      await apiRequest(`/api/allowed-domains/${row.id}`, { method: 'DELETE' }, token);
      await loadDomains();
      setDomainDeleteConfirm(null);
    } catch (err) {
      setError(err.error || 'Delete failed');
    } finally {
      setDomainSaving(false);
    }
  }

  async function loadBusinessUnits() {
    const data = await apiRequest('/api/business-units', {}, token);
    setBusinessUnits(data.business_units || []);
  }

  function openAddBu() {
    setEditingBu(null);
    setBuForm({ name: '' });
    setShowBuForm(true);
  }

  function openEditBu(row) {
    setEditingBu(row);
    setBuForm({ name: row.name });
    setShowBuForm(true);
  }

  async function handleSaveBu(e) {
    e.preventDefault();
    setError('');
    setBuSaving(true);
    try {
      const name = (buForm.name || '').trim();
      if (!name) {
        setError('Name is required');
        setBuSaving(false);
        return;
      }
      if (editingBu) {
        await apiRequest(`/api/business-units/${editingBu.id}`, { method: 'PUT', body: JSON.stringify({ name }) }, token);
      } else {
        await apiRequest('/api/business-units', { method: 'POST', body: JSON.stringify({ name }) }, token);
      }
      await loadBusinessUnits();
      setShowBuForm(false);
      setEditingBu(null);
      setBuForm({ name: '' });
    } catch (err) {
      setError(err.error || 'Save failed');
    } finally {
      setBuSaving(false);
    }
  }

  async function handleDeleteBu(row) {
    setError('');
    setBuSaving(true);
    try {
      await apiRequest(`/api/business-units/${row.id}`, { method: 'DELETE' }, token);
      await loadBusinessUnits();
      setBuDeleteConfirm(null);
    } catch (err) {
      setError(err.error || 'Delete failed');
    } finally {
      setBuSaving(false);
    }
  }

  async function loadUsers() {
    const data = await apiRequest('/api/users', {}, token);
    setUsers(data.users || []);
  }

  function openUserBuEdit(u) {
    setUserEditBu(u);
    setUserBuForm(u.business_unit_id || '');
  }

  async function handleSaveUserBu(e) {
    e.preventDefault();
    setError('');
    setUserBuSaving(true);
    try {
      const buId = userBuForm === '' || userBuForm === '_none' ? null : userBuForm;
      await apiRequest(`/api/users/${userEditBu.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ business_unit_id: buId }),
      }, token);
      await loadUsers();
      setUserEditBu(null);
      setUserBuForm('');
    } catch (err) {
      setError(err.error || 'Update failed');
    } finally {
      setUserBuSaving(false);
    }
  }

  function openAddUser() {
    setAddUserForm({ email: '', password: '', password_retype: '', role: 'Employee', business_unit_id: '' });
    setShowAddUserForm(true);
    setError('');
  }

  async function handleAddUser(e) {
    e.preventDefault();
    setError('');
    setAddUserSaving(true);
    try {
      await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          email: addUserForm.email.trim(),
          password: addUserForm.password,
          password_retype: addUserForm.password_retype,
          role: addUserForm.role,
          business_unit_id: addUserForm.business_unit_id === '' ? null : addUserForm.business_unit_id,
        }),
      }, token);
      await loadUsers();
      setShowAddUserForm(false);
      setAddUserForm({ email: '', password: '', password_retype: '', role: 'Employee', business_unit_id: '' });
    } catch (err) {
      setError(err.error || 'Create failed');
    } finally {
      setAddUserSaving(false);
    }
  }

  async function handleDeactivate() {
    if (!userDeactivateConfirm) return;
    setError('');
    try {
      await apiRequest(`/api/users/${userDeactivateConfirm.id}/deactivate`, { method: 'POST' }, token);
      await loadUsers();
      setUserDeactivateConfirm(null);
    } catch (err) {
      setError(err.error || 'Deactivate failed');
    }
  }

  async function handleResetPassword(u) {
    setError('');
    try {
      const data = await apiRequest(`/api/users/${u.id}/reset-password`, { method: 'POST' }, token);
      setResetPasswordResult({ email: u.email, temporary_password: data.temporary_password });
    } catch (err) {
      setError(err.error || 'Reset password failed');
    }
  }

  function copyPasswordToClipboard() {
    if (!resetPasswordResult?.temporary_password) return;
    navigator.clipboard.writeText(resetPasswordResult.temporary_password);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description,
        icon_url: form.icon_url,
        target_url: form.target_url,
        target_bu_id: form.target_bu_id === '' ? null : form.target_bu_id,
      };
      if (editing) {
        await apiRequest(`/api/applications/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) }, token);
      } else {
        await apiRequest('/api/applications', { method: 'POST', body: JSON.stringify(payload) }, token);
      }
      const data = await apiRequest('/api/applications', {}, token);
      setApplications(data.applications || []);
      setEditing(null);
      setShowForm(false);
      setForm({ name: '', description: '', icon_url: '', target_url: '', target_bu_id: '' });
    } catch (err) {
      setError(err.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(app) {
    setError('');
    setSaving(true);
    try {
      await apiRequest(`/api/applications/${app.id}`, { method: 'DELETE' }, token);
      setApplications((prev) => prev.filter((a) => a.id !== app.id));
      setDeleteConfirm(null);
    } catch (err) {
      setError(err.error || 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (user?.role !== 'Admin') return;
    if (!activeSection) navigate('/admin/domains', { replace: true });
  }, [user?.role, activeSection, navigate]);

  if (user?.role !== 'Admin') {
    return (
      <div style={styles.page}>
        <p>Admin access required.</p>
        <Link to="/">Back to Dashboard</Link>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>Admin — Downstream Hub</h1>
        <div style={styles.userRow}>
          <Link to="/" style={styles.backLink}>Dashboard</Link>
          <span style={styles.userEmail}>{user?.email}</span>
          <button type="button" onClick={logout} className="btn-secondary" style={styles.logoutBtn}>Sign out</button>
        </div>
      </header>
      <div style={styles.layout}>
        <nav style={styles.sidebar}>
          {SECTIONS.map((s) => (
            <Link
              key={s.id}
              to={`/admin/${s.path}`}
              style={activeSection === s.path ? styles.sidebarLinkActive : styles.sidebarLink}
            >
              {s.label}
            </Link>
          ))}
        </nav>
        <main style={styles.main}>
          {error && <div style={styles.error}>{error}</div>}

          {activeSection === 'domains' && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Allowed Domains</h2>
          <p style={styles.sectionDesc}>Only users with these email domains can register (e.g. example.com).</p>
          <div style={styles.toolbar}>
            <button type="button" className="btn-secondary" onClick={openAddDomain}>Add domain</button>
          </div>
          {showDomainForm && (
            <form onSubmit={handleSaveDomain} style={styles.form}>
              <input
                placeholder="Domain (e.g. example.com)"
                value={domainForm.domain}
                onChange={(e) => setDomainForm((f) => ({ ...f, domain: e.target.value }))}
                required
                style={styles.input}
              />
              <div style={styles.formActions}>
                <button type="submit" className="btn-primary" disabled={domainSaving}>{domainSaving ? 'Saving…' : 'Save'}</button>
                <button type="button" className="btn-secondary" onClick={() => { setShowDomainForm(false); setEditingDomain(null); setDomainForm({ domain: '' }); }}>Cancel</button>
              </div>
            </form>
          )}
          {domainsLoading ? (
            <p>Loading…</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.tableHeader}>Domain</th>
                  <th style={{ ...styles.tableHeader, width: 150 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {domains.map((d) => (
                  <tr key={d.id}>
                    <td style={styles.tableCell}>{d.domain}</td>
                    <td style={styles.actionsCell}>
                      <button type="button" className="btn-secondary" onClick={() => openEditDomain(d)}>Edit</button>
                      <button type="button" className="btn-danger" onClick={() => setDomainDeleteConfirm(d)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {domainDeleteConfirm && (
            <div style={styles.modal}>
              <div style={styles.modalContent}>
                <p>Remove domain &quot;{domainDeleteConfirm.domain}&quot;? New registrations from this domain will be blocked. You cannot delete the last domain.</p>
                <div style={styles.modalActions}>
                  <button type="button" className="btn-danger" onClick={() => handleDeleteDomain(domainDeleteConfirm)} disabled={domainSaving}>{domainSaving ? 'Deleting…' : 'Delete'}</button>
                  <button type="button" className="btn-secondary" onClick={() => setDomainDeleteConfirm(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}
        </section>
          )}

          {activeSection === 'business-units' && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Business Units</h2>
          <p style={styles.sectionDesc}>Map users and applications to departments. Apps with no BU are &quot;Global&quot; (visible to all).</p>
          <div style={styles.toolbar}>
            <button type="button" className="btn-secondary" onClick={openAddBu}>Add business unit</button>
          </div>
          {showBuForm && (
            <form onSubmit={handleSaveBu} style={styles.form}>
              <input
                placeholder="Name (e.g. Engineering)"
                value={buForm.name}
                onChange={(e) => setBuForm((f) => ({ ...f, name: e.target.value }))}
                required
                style={styles.input}
              />
              <div style={styles.formActions}>
                <button type="submit" className="btn-primary" disabled={buSaving}>{buSaving ? 'Saving…' : 'Save'}</button>
                <button type="button" className="btn-secondary" onClick={() => { setShowBuForm(false); setEditingBu(null); setBuForm({ name: '' }); }}>Cancel</button>
              </div>
            </form>
          )}
          {busLoading ? (
            <p>Loading…</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.tableHeader}>Name</th>
                  <th style={{ ...styles.tableHeader, width: 150 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {businessUnits.map((bu) => (
                  <tr key={bu.id}>
                    <td style={styles.tableCell}>{bu.name}</td>
                    <td style={styles.actionsCell}>
                      <button type="button" className="btn-secondary" onClick={() => openEditBu(bu)}>Edit</button>
                      <button type="button" className="btn-danger" onClick={() => setBuDeleteConfirm(bu)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {buDeleteConfirm && (
            <div style={styles.modal}>
              <div style={styles.modalContent}>
                <p>Delete business unit &quot;{buDeleteConfirm.name}&quot;? Users and apps linked to it will be unassigned.</p>
                <div style={styles.modalActions}>
                  <button type="button" className="btn-danger" onClick={() => handleDeleteBu(buDeleteConfirm)} disabled={buSaving}>{buSaving ? 'Deleting…' : 'Delete'}</button>
                  <button type="button" className="btn-secondary" onClick={() => setBuDeleteConfirm(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}
        </section>
          )}

          {activeSection === 'users' && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Users</h2>
          <p style={styles.sectionDesc}>Create users, assign Business Units, deactivate users, or reset passwords. Copy the new password after reset to pass it to the user.</p>
          <div style={styles.toolbar}>
            <button type="button" className="btn-primary" onClick={openAddUser} style={styles.primaryBtn}>Add user</button>
          </div>
          {showAddUserForm && (
            <form onSubmit={handleAddUser} style={styles.form}>
              <h3 style={styles.formTitle}>New user</h3>
              <input
                type="email"
                placeholder="Email"
                value={addUserForm.email}
                onChange={(e) => setAddUserForm((f) => ({ ...f, email: e.target.value }))}
                style={styles.input}
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={addUserForm.password}
                onChange={(e) => setAddUserForm((f) => ({ ...f, password: e.target.value }))}
                style={styles.input}
                minLength={6}
                required
              />
              <input
                type="password"
                placeholder="Confirm password"
                value={addUserForm.password_retype}
                onChange={(e) => setAddUserForm((f) => ({ ...f, password_retype: e.target.value }))}
                style={styles.input}
                minLength={6}
                required
              />
              <select
                value={addUserForm.role}
                onChange={(e) => setAddUserForm((f) => ({ ...f, role: e.target.value }))}
                style={styles.input}
              >
                <option value="Employee">Employee</option>
                <option value="Admin">Admin</option>
              </select>
              <select
                value={addUserForm.business_unit_id || '_none'}
                onChange={(e) => setAddUserForm((f) => ({ ...f, business_unit_id: e.target.value === '_none' ? '' : e.target.value }))}
                style={styles.input}
              >
                <option value="_none">— No business unit —</option>
                {businessUnits.map((bu) => (
                  <option key={bu.id} value={bu.id}>{bu.name}</option>
                ))}
              </select>
              <div style={styles.formActions}>
                <button type="submit" className="btn-primary" disabled={addUserSaving}>{addUserSaving ? 'Creating…' : 'Create user'}</button>
                <button type="button" className="btn-secondary" onClick={() => { setShowAddUserForm(false); setError(''); }}>Cancel</button>
              </div>
            </form>
          )}
          {usersLoading ? (
            <p>Loading…</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.tableHeader}>Email</th>
                  <th style={styles.tableHeader}>Role</th>
                  <th style={styles.tableHeader}>Business Unit</th>
                  <th style={{ ...styles.tableHeader, width: 280 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={styles.tableCell}>{u.email}</td>
                    <td style={styles.tableCell}>{u.role}</td>
                    <td style={styles.tableCell}>{u.business_unit_name || '—'}</td>
                    <td style={styles.actionsCell}>
                      <button type="button" className="btn-secondary" onClick={() => openUserBuEdit(u)}>Edit BU</button>
                      <button type="button" className="btn-secondary" onClick={() => handleResetPassword(u)}>Reset password</button>
                      <button type="button" className="btn-secondary" onClick={() => setUserDeactivateConfirm(u)}>Deactivate</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {userEditBu && (
            <div style={styles.modal}>
              <div style={styles.modalContent}>
                <p><strong>{userEditBu.email}</strong> — set Business Unit:</p>
                <form onSubmit={handleSaveUserBu} style={{ marginTop: 'var(--space-3)' }}>
                  <select
                    value={userBuForm === null || userBuForm === undefined ? '_none' : userBuForm}
                    onChange={(e) => setUserBuForm(e.target.value === '_none' ? '' : e.target.value)}
                    style={{ ...styles.input, maxWidth: '100%' }}
                  >
                    <option value="_none">None</option>
                    {businessUnits.map((bu) => (
                      <option key={bu.id} value={bu.id}>{bu.name}</option>
                    ))}
                  </select>
                  <div style={styles.formActions}>
                    <button type="submit" className="btn-primary" disabled={userBuSaving}>{userBuSaving ? 'Saving…' : 'Save'}</button>
                    <button type="button" className="btn-secondary" onClick={() => { setUserEditBu(null); setUserBuForm(''); }}>Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}
          {userDeactivateConfirm && (
            <div style={styles.modal}>
              <div style={styles.modalContent}>
                <p>Deactivate user <strong>{userDeactivateConfirm.email}</strong>? They will not be able to log in.</p>
                <div style={styles.formActions}>
                  <button type="button" className="btn-primary" onClick={handleDeactivate}>Deactivate</button>
                  <button type="button" className="btn-secondary" onClick={() => setUserDeactivateConfirm(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}
          {resetPasswordResult && (
            <div style={styles.modal}>
              <div style={styles.modalContent}>
                <p>Password reset for <strong>{resetPasswordResult.email}</strong>. Copy the password and pass it to the user (no email sent):</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                  <input
                    type="text"
                    readOnly
                    value={resetPasswordResult.temporary_password}
                    style={{ ...styles.input, flex: 1, fontFamily: 'monospace' }}
                  />
                  <button type="button" className="btn-primary" onClick={copyPasswordToClipboard}>Copy</button>
                </div>
                <div style={{ ...styles.formActions, marginTop: 'var(--space-3)' }}>
                  <button type="button" className="btn-secondary" onClick={() => setResetPasswordResult(null)}>Close</button>
                </div>
              </div>
            </div>
          )}
        </section>
          )}

          {activeSection === 'applications' && (
        <>
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Applications</h2>
          <p style={styles.sectionDesc}>Add and manage internal apps. Set <strong>Target BU</strong> to limit visibility to one Business Unit, or leave as &quot;All BUs (Global)&quot; so everyone sees the app. URL validation and confirmation before delete.</p>
        </section>
        <div style={styles.toolbar}>
          <button type="button" className="btn-primary" onClick={openCreate} style={styles.primaryBtn}>Add application</button>
        </div>

        {showForm && (
          <form key={editing ? editing.id : 'new'} onSubmit={handleSave} style={styles.form}>
            <h3 style={styles.formTitle}>{editing ? 'Edit application' : 'New application'}</h3>
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              style={styles.input}
            />
            <input
              placeholder="Description (optional)"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              style={styles.input}
            />
            <input
              placeholder="Icon URL (optional)"
              value={form.icon_url}
              onChange={(e) => setForm((f) => ({ ...f, icon_url: e.target.value }))}
              style={styles.input}
            />
            <input
              placeholder="Target URL (e.g. https://app.example.com)"
              value={form.target_url}
              onChange={(e) => setForm((f) => ({ ...f, target_url: e.target.value }))}
              required
              type="url"
              style={styles.input}
            />
            <label style={styles.label}>Target Business Unit</label>
            <select
              value={form.target_bu_id === null || form.target_bu_id === undefined ? '' : form.target_bu_id}
              onChange={(e) => setForm((f) => ({ ...f, target_bu_id: e.target.value === '' ? null : e.target.value }))}
              style={styles.input}
            >
              <option value="">All BUs (Global)</option>
              {businessUnits.map((bu) => (
                <option key={bu.id} value={bu.id}>{bu.name}</option>
              ))}
            </select>
            <div style={styles.formActions}>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" className="btn-secondary" onClick={() => { setEditing(null); setShowForm(false); setForm({ name: '', description: '', icon_url: '', target_url: '', target_bu_id: '' }); }}>Cancel</button>
            </div>
          </form>
        )}

        {loading ? (
          <p>Loading…</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.tableHeader}>Name</th>
                <th style={styles.tableHeader}>Target URL</th>
                <th style={styles.tableHeader}>Target BU</th>
                <th style={{ ...styles.tableHeader, width: 150, minWidth: 150 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => (
                <tr key={app.id}>
                  <td style={styles.tableCell}>{app.name}</td>
                  <td style={{ ...styles.tableCell, ...styles.urlCell }}>{app.target_url}</td>
                  <td style={styles.tableCell}>{app.target_bu_name || 'Global'}</td>
                  <td style={styles.actionsCell}>
                    <button type="button" className="btn-secondary" onClick={() => openEdit(app)}>Edit</button>
                    <button type="button" className="btn-danger" onClick={() => setDeleteConfirm(app)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {deleteConfirm && (
          <div style={styles.modal}>
            <div style={styles.modalContent}>
              <p>Delete &quot;{deleteConfirm.name}&quot;? This cannot be undone.</p>
              <div style={styles.modalActions}>
                <button type="button" className="btn-danger" onClick={() => handleDelete(deleteConfirm)} disabled={saving}>
                  {saving ? 'Deleting…' : 'Delete'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
        </>
          )}

          {activeSection === 'password-policy' && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Password policy</h2>
          <p style={styles.sectionDesc}>Require users to change their password after a number of days. Set to <strong>0</strong> to disable expiry.</p>
          {policyLoading ? (
            <p>Loading…</p>
          ) : (
            <form onSubmit={handleSavePasswordPolicy} style={styles.form}>
              <label style={styles.label}>Password expires after (days)</label>
              <input
                type="number"
                min={0}
                max={365}
                value={passwordExpiryDays}
                onChange={(e) => setPasswordExpiryDays(parseInt(e.target.value, 10) || 0)}
                style={{ ...styles.input, maxWidth: 120 }}
              />
              <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-small)', color: 'var(--color-text-steel)' }}>0 = never expire. Max 365 days.</p>
              <div style={styles.formActions}>
                <button type="submit" className="btn-primary" disabled={policySaving}>{policySaving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          )}
        </section>
          )}
        </main>
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: 'var(--color-bg-light)', display: 'flex', flexDirection: 'column' },
  header: { background: 'var(--color-bg-white)', padding: 'var(--space-3) var(--space-4)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { margin: 0, fontSize: 'var(--text-h3)', fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-charcoal)' },
  userRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)' },
  backLink: { color: 'var(--color-primary)', textDecoration: 'none', fontSize: 'var(--text-small)' },
  userEmail: { fontSize: 'var(--text-small)', color: 'var(--color-text-steel)' },
  logoutBtn: {},
  layout: { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' },
  sidebar: { width: 200, flexShrink: 0, minHeight: 0, overflowY: 'auto', background: 'var(--color-bg-white)', borderRight: '1px solid var(--color-border-light)', padding: 'var(--space-4) var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' },
  sidebarLink: { padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-charcoal)', textDecoration: 'none', fontSize: 'var(--text-small)', transition: 'background var(--duration-fast)' },
  sidebarLinkActive: { padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', textDecoration: 'none', fontSize: 'var(--text-small)', fontWeight: 'var(--font-weight-medium)' },
  main: { flex: 1, maxWidth: 900, margin: 0, padding: 'var(--space-4)', overflow: 'auto' },
  error: { padding: 'var(--space-3)', background: '#FEE2E2', color: 'var(--color-destructive)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-3)', fontSize: 'var(--text-small)' },
  toolbar: { marginBottom: 'var(--space-4)', position: 'relative', zIndex: 1 },
  primaryBtn: {},
  form: { background: 'var(--color-bg-white)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)', boxShadow: 'var(--shadow-md)' },
  formTitle: { margin: '0 0 var(--space-3)', fontSize: 'var(--text-h3)', fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-charcoal)' },
  input: { display: 'block', width: '100%', maxWidth: 400, padding: 'var(--space-2) var(--space-3)', marginBottom: 'var(--space-3)', border: '1px solid var(--color-border-medium)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-base)' },
  formActions: { display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' },
  table: { width: '100%', background: 'var(--color-bg-white)', borderRadius: 'var(--radius-md)', borderCollapse: 'collapse', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--color-border-light)' },
  tableHeader: { borderBottom: '1px solid var(--color-border-light)', padding: 'var(--space-2) var(--space-3)', textAlign: 'left', fontWeight: 'var(--font-weight-medium)', fontSize: 'var(--text-small)', color: 'var(--color-text-charcoal)' },
  tableCell: { padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--color-border-light)', fontSize: 'var(--text-small)' },
  actionsCell: { padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--color-border-light)', fontSize: 'var(--text-small)', display: 'flex', flexDirection: 'row', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'nowrap' },
  urlCell: { fontSize: 'var(--text-xs)', color: 'var(--color-text-steel)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  modal: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  modalContent: { background: 'var(--color-bg-white)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', maxWidth: 400, boxShadow: 'var(--shadow-lg)' },
  modalActions: { display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' },
  section: { marginBottom: 'var(--space-6)' },
  sectionTitle: { margin: '0 0 var(--space-1)', fontSize: 'var(--text-h3)', fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-charcoal)' },
  sectionDesc: { margin: '0 0 var(--space-3)', fontSize: 'var(--text-small)', color: 'var(--color-text-steel)' },
  label: { display: 'block', marginBottom: 'var(--space-1)', fontSize: 'var(--text-small)', fontWeight: 'var(--font-weight-medium)', color: 'var(--color-text-charcoal)' },
};
