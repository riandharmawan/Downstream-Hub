/**
 * Hub-wide session revalidation policy (X days from last_hub_session_revalidated_at).
 * @param {{ last_hub_session_revalidated_at?: string | Date | null }} user
 * @param {{ hub_session_revalidation_days?: number }} policy
 */
function isHubRevalidationDue(user, policy) {
  const X = Math.max(0, parseInt(String(policy.hub_session_revalidation_days ?? 0), 10) || 0);
  if (X <= 0) return false;
  const at = user.last_hub_session_revalidated_at;
  if (!at) return false;
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return false;
  const ms = X * 24 * 60 * 60 * 1000;
  return Date.now() - t >= ms;
}

module.exports = { isHubRevalidationDue };
