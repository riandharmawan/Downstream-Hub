/**
 * Test helpers for integration tests (Bearer tokens no longer returned in API responses).
 */
const usersDb = require('../../db/usersDb');
const { signAccessToken } = require('../../lib/authToken');

async function bearerTokenForUser(pool, userId) {
  const user = await usersDb.getById(pool, userId);
  if (!user) throw new Error('user not found');
  const tv = await usersDb.getTokenVersion(pool, userId);
  return signAccessToken({ id: user.id, email: user.email, role: user.role, token_version: tv });
}

async function bearerFromAuthResponse(pool, res) {
  if (!res.body.user?.id) throw new Error('no user in auth response');
  return bearerTokenForUser(pool, res.body.user.id);
}

module.exports = { bearerTokenForUser, bearerFromAuthResponse };
