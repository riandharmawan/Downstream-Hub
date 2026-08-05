import { createContext, useContext, useState, useEffect } from 'react';
import { apiRequest } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiRequest('/api/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => {
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data.mfa_required || data.magic_link_required) return data;
    setToken(data.token || null);
    setUser(data.user || null);
    return data;
  };

  const verifyMfa = async (challenge_id, otp) => {
    const data = await apiRequest('/api/auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({ challenge_id, otp }),
    });
    setToken(data.token || null);
    setUser(data.user || null);
    return data;
  };

  const loginWithMagicToken = async (rawToken) => {
    const data = await apiRequest('/api/auth/magic-link/verify', {
      method: 'POST',
      body: JSON.stringify({ token: rawToken }),
    });
    setToken(data.token || null);
    setUser(data.user || null);
    return data;
  };

  const resendMagicLink = async (email, password, pending_id) => {
    return apiRequest('/api/auth/magic-link/resend', {
      method: 'POST',
      body: JSON.stringify({ email, password, pending_id }),
    });
  };

  const setSession = (newToken, newUser) => {
    setToken(newToken || null);
    setUser(newUser || null);
  };

  const register = async (email, password, { password_retype, business_unit_id } = {}) => {
    const data = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, password_retype, business_unit_id: business_unit_id || undefined }),
    });
    setToken(data.token || null);
    setUser(data.user || null);
    return data;
  };

  const logout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' }, token);
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{
      user, token, loading, login, verifyMfa, loginWithMagicToken, resendMagicLink, register, logout, setSession,
    }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
