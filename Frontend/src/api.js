const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export function getApiUrl(path) {
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function apiRequest(path, options = {}, token = null) {
  const url = getApiUrl(path);
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (e) {
    const isNetwork =
      e instanceof TypeError &&
      (String(e.message).includes('fetch') || String(e.message).includes('Failed to fetch') || String(e.message).includes('NetworkError'));
    throw {
      status: 0,
      error: isNetwork
        ? 'Cannot reach the API. Is the backend running on port 4000? (Check the terminal and http://localhost:4000/health )'
        : e.message || 'Network error',
    };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

/** Multipart upload (field name `file`). Do not set Content-Type — browser sets boundary. */
export async function apiUpload(path, file, token) {
  const url = getApiUrl(path);
  const formData = new FormData();
  formData.append('file', file);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: formData, headers });
  } catch (e) {
    const isNetwork =
      e instanceof TypeError &&
      (String(e.message).includes('fetch') || String(e.message).includes('Failed to fetch') || String(e.message).includes('NetworkError'));
    throw {
      status: 0,
      error: isNetwork
        ? 'Cannot reach the API. Is the backend running (e.g. http://localhost:4000)?'
        : e.message || 'Network error',
    };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}
