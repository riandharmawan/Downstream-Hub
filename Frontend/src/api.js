const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export function getApiUrl(path) {
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function apiRequest(path, options = {}, token = null) {
  const url = getApiUrl(path);
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}
