import { apiRequest } from '../api';

const FALLBACK = {
  min_password_length: 6,
  require_uppercase: true,
  require_lowercase: true,
  require_number: true,
  require_symbol: true,
};

let cached = null;
let cachePromise = null;

export async function fetchPasswordRequirements() {
  if (cached) return cached;
  if (!cachePromise) {
    cachePromise = apiRequest('/api/auth/password-requirements')
      .then((data) => {
        cached = { ...FALLBACK, ...data };
        return cached;
      })
      .catch(() => {
        cached = { ...FALLBACK };
        return cached;
      });
  }
  return cachePromise;
}

export function passwordLengthHint(minLength, prefix = 'Password') {
  return `${prefix} (min ${minLength} characters)`;
}
