/**
 * JWT auth middleware. Validates signature, expiry, and token_version (`tv`) vs database.
 */
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const usersDb = require('../db/usersDb');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.tv === undefined || payload.tv === null) {
      return res.status(401).json({ error: 'Please sign in again.', code: 'TOKEN_STALE' });
    }
    const dbTv = await usersDb.getTokenVersion(pool, payload.sub);
    if (dbTv === null || Number(dbTv) !== Number(payload.tv)) {
      return res.status(401).json({ error: 'Please sign in again.', code: 'TOKEN_STALE' });
    }
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'Admin') return next();
  return res.status(403).json({ error: 'Admin access required' });
}

async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.tv === undefined || payload.tv === null) {
      req.user = null;
      return next();
    }
    const dbTv = await usersDb.getTokenVersion(pool, payload.sub);
    if (dbTv === null || Number(dbTv) !== Number(payload.tv)) {
      req.user = null;
      return next();
    }
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
  } catch {
    req.user = null;
  }
  next();
}

module.exports = { authMiddleware, requireAdmin, optionalAuth, JWT_SECRET };
