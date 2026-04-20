import { getApiUrl } from '../api';

/** Resolve icon URL for <img src> (absolute http(s) or API-relative /uploads/...). */
export function resolveIconSrc(iconUrl) {
  const u = iconUrl != null ? String(iconUrl).trim() : '';
  if (!u) return null;
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  return getApiUrl(u.startsWith('/') ? u : `/${u}`);
}
