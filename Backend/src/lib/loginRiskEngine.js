/**
 * Case 5 V1 login risk evaluation.
 * V2 signals (geo/device) can be added via adapter boundary below.
 */
function normalizeMode(policy) {
  const mode = String(policy?.login_risk_mode || 'off').trim().toLowerCase();
  return mode === 'monitor' || mode === 'enforce' ? mode : 'off';
}

function isEnabled(policy) {
  return !!policy?.login_risk_enabled && normalizeMode(policy) !== 'off';
}

async function evaluateLoginRisk({ policy, currentIp, contextDb, userId }) {
  const mode = normalizeMode(policy);
  const result = {
    enabled: isEnabled(policy),
    mode,
    risky: false,
    requiresChallenge: false,
    reasons: [],
    metadata: {},
  };
  if (!result.enabled || !currentIp || !userId) return result;

  const knownWindowDays = Math.max(1, Math.min(365, parseInt(String(policy.login_risk_known_ip_window_days || 90), 10) || 90));
  const knownSince = new Date(Date.now() - knownWindowDays * 24 * 60 * 60 * 1000);
  const knownIp = await contextDb.getByUserAndIp(userId, currentIp);
  const isKnownWithinWindow = !!(knownIp && new Date(knownIp.last_seen_at).getTime() >= knownSince.getTime());
  if (!isKnownWithinWindow) {
    result.risky = true;
    result.reasons.push('NEW_IP');
  }

  const distinctThreshold = Math.max(
    0,
    Math.min(50, parseInt(String(policy.login_risk_max_distinct_ips_24h || 0), 10) || 0)
  );
  if (distinctThreshold > 0) {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const distinctIps24h = await contextDb.countDistinctIpsSince(userId, since24h);
    result.metadata.distinct_ips_24h = distinctIps24h;
    if (distinctIps24h >= distinctThreshold) {
      result.risky = true;
      result.reasons.push('HIGH_IP_CHURN_24H');
    }
  }

  // V2 adapter boundary placeholder (GeoIP/device signals).
  result.metadata.v2_adapter_ready = true;
  result.requiresChallenge = result.risky && mode === 'enforce';
  return result;
}

module.exports = {
  evaluateLoginRisk,
  normalizeMode,
  isEnabled,
};
