const crypto = require('crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

async function insertAuthCode(db, payload) {
  const {
    rawCode,
    userId,
    applicationId,
    clientId,
    redirectUri,
    scope,
    nonce,
    codeChallenge,
    codeChallengeMethod,
    expiresAt,
  } = payload;

  await db.query(
    `INSERT INTO oidc_authorization_codes
      (code_hash, user_id, application_id, client_id, redirect_uri, scope, nonce, code_challenge, code_challenge_method, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [sha256(rawCode), userId, applicationId, clientId, redirectUri, scope, nonce || null, codeChallenge, codeChallengeMethod, expiresAt]
  );
}

async function consumeAuthCode(db, rawCode) {
  const { rows } = await db.query(
    `UPDATE oidc_authorization_codes
     SET consumed_at = now()
     WHERE code_hash = $1
       AND consumed_at IS NULL
       AND expires_at > now()
     RETURNING *`,
    [sha256(rawCode)]
  );
  return rows[0] || null;
}

module.exports = { insertAuthCode, consumeAuthCode };
