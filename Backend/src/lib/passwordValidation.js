/**
 * Validate password against policy (length and complexity).
 * Policy: min_password_length, require_uppercase, require_lowercase, require_number, require_symbol (booleans).
 * Returns { valid: true } or { valid: false, error: string }.
 */
function validatePassword(password, policy) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  const minLen = Math.max(6, parseInt(policy.min_password_length, 10) || 6);
  if (password.length < minLen) {
    return { valid: false, error: `Password must be at least ${minLen} characters` };
  }
  if (policy.require_uppercase && !/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must include at least one uppercase letter' };
  }
  if (policy.require_lowercase && !/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must include at least one lowercase letter' };
  }
  if (policy.require_number && !/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must include at least one number' };
  }
  if (policy.require_symbol && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    return { valid: false, error: 'Password must include at least one symbol' };
  }
  return { valid: true };
}

module.exports = { validatePassword };
