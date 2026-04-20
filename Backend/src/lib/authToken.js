/**
 * JWT access tokens for Hub API. Includes `tv` (token_version) for invalidation after password change.
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * @param {{ id: string, email: string, role: string, token_version?: number }} user
 */
function signAccessToken(user) {
  const tv = user.token_version != null ? Number(user.token_version) : 0;
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, tv },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

module.exports = { signAccessToken, JWT_SECRET, JWT_EXPIRES_IN };
