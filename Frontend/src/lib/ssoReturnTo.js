/** @param {string} search - location.search including leading ? */
export function getSsoLoginParams(search) {
  const params = new URLSearchParams(search || '');
  return {
    returnTo: params.get('returnTo') || '',
    clientId: params.get('client_id') || '',
  };
}

export function isSafeSsoReturnTo(path) {
  if (!path || typeof path !== 'string') return false;
  if (!path.startsWith('/api/sso/authorize')) return false;
  if (path.includes('//') || path.includes(':\\')) return false;
  return true;
}

/** Full navigation so HttpOnly session cookie is sent to /api/sso/authorize. */
export function resumeAfterLogin(returnTo, navigate) {
  if (returnTo && isSafeSsoReturnTo(returnTo)) {
    window.location.href = returnTo;
    return;
  }
  navigate('/', { replace: true });
}

export function ssoLoginBodyExtras(returnTo, clientId) {
  const body = {};
  if (returnTo && isSafeSsoReturnTo(returnTo)) body.return_to = returnTo;
  if (clientId) body.client_id = String(clientId).trim();
  return body;
}
