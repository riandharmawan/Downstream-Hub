const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;

/**
 * Resolve configured minimum length within allowed bounds (6–128).
 */
function resolveMinPasswordLength(policy) {
  const configured = parseInt(policy?.min_password_length, 10);
  const value = Number.isFinite(configured) ? configured : MIN_PASSWORD_LENGTH;
  return Math.max(MIN_PASSWORD_LENGTH, Math.min(MAX_PASSWORD_LENGTH, value));
}

/**
 * Public-facing password requirements derived from policy.
 */
function passwordRequirementsFromPolicy(policy) {
  return {
    min_password_length: resolveMinPasswordLength(policy),
    require_uppercase: !!policy?.require_uppercase,
    require_lowercase: !!policy?.require_lowercase,
    require_number: !!policy?.require_number,
    require_symbol: !!policy?.require_symbol,
  };
}

/**
 * Validate password against policy (length and complexity).
 * Policy: min_password_length, require_uppercase, require_lowercase, require_number, require_symbol (booleans).
 * Returns { valid: true } or { valid: false, error: string }.
 */
function validatePassword(password, policy) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  const minLen = resolveMinPasswordLength(policy);
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

module.exports = {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  resolveMinPasswordLength,
  passwordRequirementsFromPolicy,
  validatePassword,
};
