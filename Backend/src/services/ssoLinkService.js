const crypto = require('crypto');
const ssoLinkDb = require('../db/ssoLinkDb');
const usersDb = require('../db/usersDb');
const userApplicationSsoDb = require('../db/userApplicationSsoDb');

const EMAIL_VERIFY_TTL_MINUTES = Math.max(5, Math.min(60, parseInt(process.env.SSO_LINK_EMAIL_VERIFY_TTL_MINUTES || '15', 10)));

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeSubject(sub) {
  return String(sub || '').trim();
}

function buildSyntheticSubjectForUser(user) {
  return `hub:${user.id}`;
}

async function getUserStatus(db, userId) {
  return ssoLinkDb.getUserSsoStatus(db, userId);
}

async function linkUserSubject(db, { actorId, user, subject, mode }) {
  const normalizedSub = normalizeSubject(subject);
  if (!normalizedSub) {
    return { ok: false, code: 'missing_subject' };
  }
  const existing = await ssoLinkDb.getByOidcSub(db, normalizedSub);
  if (existing && existing.id !== user.id) {
    await ssoLinkDb.insertLinkEvent(db, {
      userId: user.id,
      actorId,
      mode,
      eventType: 'link_attempt',
      status: 'blocked',
      reasonCode: 'oidc_sub_already_linked',
      subjectFingerprint: ssoLinkDb.subjectFingerprint(normalizedSub),
    });
    return { ok: false, code: 'oidc_sub_already_linked' };
  }
  const linked = await ssoLinkDb.linkOidcSubToUser(db, { userId: user.id, oidcSub: normalizedSub, mode });
  await ssoLinkDb.insertLinkEvent(db, {
    userId: user.id,
    actorId,
    mode,
    eventType: 'link',
    status: 'success',
    subjectFingerprint: ssoLinkDb.subjectFingerprint(normalizedSub),
  });
  return { ok: true, linked };
}

async function createEmailVerification(db, { actorId = null, user, subject, mode, applicationId }) {
  const normalizedSub = normalizeSubject(subject);
  if (!normalizedSub) return { ok: false, code: 'missing_subject' };
  if (!applicationId) return { ok: false, code: 'application_id_required' };
  const tokenRaw = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(tokenRaw, 'utf8').digest('hex');
  const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_MINUTES * 60 * 1000);
  await ssoLinkDb.createEmailVerification(db, {
    userId: user.id,
    actorId,
    mode,
    oidcSub: normalizedSub,
    email: normalizeEmail(user.email),
    tokenHash,
    expiresAt,
    applicationId,
  });
  await ssoLinkDb.insertLinkEvent(db, {
    userId: user.id,
    actorId,
    mode,
    eventType: 'verification_sent',
    status: 'success',
    subjectFingerprint: ssoLinkDb.subjectFingerprint(normalizedSub),
    metadata: { application_id: applicationId },
  });
  return { ok: true, tokenRaw, expiresAt };
}

async function consumeEmailVerificationAndLink(db, { actorId, tokenRaw, applicationIdFromClient = null }) {
  const tokenHash = crypto.createHash('sha256').update(String(tokenRaw || ''), 'utf8').digest('hex');
  const verification = await ssoLinkDb.consumeEmailVerification(db, tokenHash);
  if (!verification) return { ok: false, code: 'link_token_expired' };
  if (verification.application_id) {
    if (!applicationIdFromClient || String(applicationIdFromClient) !== String(verification.application_id)) {
      return { ok: false, code: 'application_id_mismatch' };
    }
    await userApplicationSsoDb.upsertVerified(db, {
      userId: verification.user_id,
      applicationId: verification.application_id,
    });
  } else {
    await usersDb.setHubOidcEmailVerifiedAt(db, verification.user_id);
  }
  const status = await ssoLinkDb.getUserSsoStatus(db, verification.user_id);
  if (!status) return { ok: false, code: 'user_not_found' };
  const user = { id: status.user_id, email: status.email };
  return linkUserSubject(db, {
    actorId: actorId || verification.actor_id || verification.user_id,
    user,
    subject: verification.oidc_sub,
    mode: verification.mode || 'email_verification',
  });
}

module.exports = {
  normalizeEmail,
  normalizeSubject,
  buildSyntheticSubjectForUser,
  getUserStatus,
  linkUserSubject,
  createEmailVerification,
  consumeEmailVerificationAndLink,
};
