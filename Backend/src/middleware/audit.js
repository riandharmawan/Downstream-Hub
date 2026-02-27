/**
 * Log admin write actions to audit_logs.
 */
const { pool } = require('../db/pool');

async function auditLog(client, { actorId, actionType, targetEntity, payloadBefore, payloadAfter, ipAddress }) {
  await client.query(
    `INSERT INTO audit_logs (actor_id, action_type, target_entity, payload_before, payload_after, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      actorId,
      actionType,
      targetEntity ?? null,
      payloadBefore ? JSON.stringify(payloadBefore) : null,
      payloadAfter ? JSON.stringify(payloadAfter) : null,
      ipAddress ?? null,
    ]
  );
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
}

module.exports = { auditLog, getClientIp };
