const crypto = require('crypto');
const fs = require('fs');
const { exportJWK, importPKCS8, importSPKI } = require('jose');

const DEFAULT_ISSUER = (process.env.SSO_ISSUER || process.env.API_PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, '');
const DEFAULT_ALG = process.env.SSO_SIGNING_ALG || 'RS256';
const KEY_ID = process.env.SSO_KID || 'hub-sso-key-1';
const STRICT_SSO = process.env.SSO_ENFORCE_STRICT === '1';

let cached = null;

function normalizePem(raw) {
  if (!raw) return '';
  return String(raw).replace(/\\n/g, '\n').trim();
}

async function loadKeys() {
  if (cached) return cached;

  let privatePem = normalizePem(process.env.SSO_PRIVATE_KEY_PEM || '');
  let publicPem = normalizePem(process.env.SSO_PUBLIC_KEY_PEM || '');
  if (!privatePem && process.env.SSO_PRIVATE_KEY_PATH) {
    privatePem = normalizePem(fs.readFileSync(process.env.SSO_PRIVATE_KEY_PATH, 'utf8'));
  }
  if (!publicPem && process.env.SSO_PUBLIC_KEY_PATH) {
    publicPem = normalizePem(fs.readFileSync(process.env.SSO_PUBLIC_KEY_PATH, 'utf8'));
  }

  if ((DEFAULT_ALG === 'RS256' || DEFAULT_ALG === 'ES256') && privatePem && publicPem) {
    const privateKey = await importPKCS8(privatePem, DEFAULT_ALG);
    const publicKey = await importSPKI(publicPem, DEFAULT_ALG);
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = KEY_ID;
    publicJwk.alg = DEFAULT_ALG;
    publicJwk.use = 'sig';
    cached = { alg: DEFAULT_ALG, kid: KEY_ID, issuer: DEFAULT_ISSUER, privateKey, publicKey, jwks: { keys: [publicJwk] } };
    return cached;
  }

  if (STRICT_SSO) {
    throw new Error('SSO strict mode enabled but asymmetric keys are missing. Set SSO_PRIVATE_KEY_PEM/SSO_PUBLIC_KEY_PEM or *_PATH.');
  }

  // Backward-compatible fallback for environments without keypairs.
  const hsSecret = process.env.SSO_TOKEN_SECRET || 'dev-sso-secret';
  cached = {
    alg: 'HS256',
    kid: 'legacy-hs256',
    issuer: DEFAULT_ISSUER,
    hsSecret: new TextEncoder().encode(hsSecret),
    jwks: { keys: [] },
  };
  return cached;
}

function hashSha256(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

module.exports = { loadKeys, hashSha256 };
