/**
 * Validates returnTo paths for app-initiated OIDC login resume.
 * Only same-origin authorize URLs are allowed (open-redirect guard).
 */
function isSafeSsoReturnTo(path) {
  if (!path || typeof path !== 'string') return false;
  if (!path.startsWith('/api/sso/authorize')) return false;
  if (path.includes('//') || path.includes(':\\')) return false;
  return true;
}

module.exports = { isSafeSsoReturnTo };
