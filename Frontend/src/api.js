const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export function getApiUrl(path) {
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function apiRequest(path, options = {}) {
  const url = getApiUrl(path);
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const csrfCookie = document.cookie
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith('hub_csrf='));
  if (csrfCookie) {
    const csrf = decodeURIComponent(csrfCookie.slice('hub_csrf='.length));
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  let res;
  try {
    res = await fetch(url, { ...options, headers, credentials: 'include' });
  } catch (e) {
    const isNetwork =
      e instanceof TypeError &&
      (String(e.message).includes('fetch') || String(e.message).includes('Failed to fetch') || String(e.message).includes('NetworkError'));
    throw {
      status: 0,
      error: isNetwork
        ? (import.meta.env.DEV
          ? 'Cannot reach the API. Is the backend running? (Check http://localhost:4000/health )'
          : 'Cannot reach the API. Please try again later.')
        : e.message || 'Network error',
    };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

/** Multipart upload (field name `file`). Do not set Content-Type — browser sets boundary. */
export async function apiUpload(path, file) {
  const url = getApiUrl(path);
  const formData = new FormData();
  formData.append('file', file);
  const headers = {};
  const csrfCookie = document.cookie
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith('hub_csrf='));
  if (csrfCookie) headers['x-csrf-token'] = decodeURIComponent(csrfCookie.slice('hub_csrf='.length));
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: formData, headers, credentials: 'include' });
  } catch (e) {
    const isNetwork =
      e instanceof TypeError &&
      (String(e.message).includes('fetch') || String(e.message).includes('Failed to fetch') || String(e.message).includes('NetworkError'));
    throw {
      status: 0,
      error: isNetwork
        ? (import.meta.env.DEV ? 'Cannot reach the API. Is the backend running?' : 'Cannot reach the API. Please try again later.')
        : e.message || 'Network error',
    };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}
