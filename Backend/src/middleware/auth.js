/**
 * JWT auth middleware. Validates signature, expiry, and token_version (`tv`) vs database.
 */
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const usersDb = require('../db/usersDb');
const authSessionsDb = require('../db/authSessionsDb');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const SESSION_COOKIE = process.env.AUTH_SESSION_COOKIE || 'hub_session';
const CSRF_COOKIE = process.env.AUTH_CSRF_COOKIE || 'hub_csrf';

function parseCookies(req) {
  const src = req.headers.cookie || '';
  return src.split(';').reduce((acc, p) => {
    const idx = p.indexOf('=');
    if (idx === -1) return acc;
    const k = p.slice(0, idx).trim();
    const v = decodeURIComponent(p.slice(idx + 1).trim());
    if (k) acc[k] = v;
    return acc;
  }, {});
}

function readBearer(req) {
  const authHeader = req.headers.authorization;
  return authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

function isMutatingMethod(req) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase());
}

async function attachUserFromJwt(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  if (payload.tv === undefined || payload.tv === null) return null;
  const dbTv = await usersDb.getTokenVersion(pool, payload.sub);
  if (dbTv === null || Number(dbTv) !== Number(payload.tv)) return { stale: true, id: payload.sub, email: payload.email, role: payload.role };
  return { id: payload.sub, email: payload.email, role: payload.role };
}

async function attachUserFromSession(req) {
  const cookies = parseCookies(req);
  const sessionToken = cookies[SESSION_COOKIE];
  if (!sessionToken) return null;
  const session = await authSessionsDb.getActiveBySessionToken(pool, sessionToken);
  if (!session) return null;
  const user = await usersDb.getById(pool, session.user_id);
  if (!user) return null;

  if (isMutatingMethod(req)) {
    const csrfHeader = req.headers['x-csrf-token'];
    const csrfCookie = cookies[CSRF_COOKIE];
    if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie || !authSessionsDb.csrfMatches(session.csrf_token_hash, csrfHeader)) {
      const err = new Error('CSRF token required');
      err.code = 'CSRF_REQUIRED';
      throw err;
    }
  }
  return { id: user.id, email: user.email, role: user.role };
}

async function authMiddleware(req, res, next) {
  try {
    const token = readBearer(req);
    if (token) {
      const user = await attachUserFromJwt(token);
      if (!user) return res.status(401).json({ error: 'Please sign in again.', code: 'TOKEN_STALE' });
      if (user.stale) {
        if (req.path === '/change-password') {
          req.user = { id: user.id, email: user.email, role: user.role };
          return next();
        }
        return res.status(401).json({ error: 'Please sign in again.', code: 'TOKEN_STALE' });
      }
      req.user = user;
      return next();
    }
    const sessionUser = await attachUserFromSession(req);
    if (!sessionUser) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = sessionUser;
    next();
  } catch (err) {
    if (err.code === 'CSRF_REQUIRED') {
      return res.status(403).json({ error: 'CSRF token required', code: 'CSRF_REQUIRED' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'Admin') return next();
  return res.status(403).json({ error: 'Admin access required' });
}

async function optionalAuth(req, res, next) {
  try {
    const token = readBearer(req);
    if (token) {
      req.user = await attachUserFromJwt(token);
      return next();
    }
    req.user = await attachUserFromSession(req);
  } catch {
    req.user = null;
  }
  next();
}

module.exports = { authMiddleware, requireAdmin, optionalAuth, JWT_SECRET };
