/**
 * @param {{
 *   supabaseHealthy: boolean,
 *   noSecurityCritical: boolean,
 *   noRecentErrors: boolean,
 *   noFailedDeploys24h: boolean,
 *   mcpChecksPassing: boolean,
 *   workerErrorRateOk: boolean,
 * }} o
 */
export function computeHealthScore(o) {
  let score = 0;
  if (o.supabaseHealthy) score += 25;
  if (o.noSecurityCritical) score += 20;
  if (o.noRecentErrors) score += 15;
  if (o.noFailedDeploys24h) score += 15;
  if (o.mcpChecksPassing) score += 15;
  if (o.workerErrorRateOk) score += 10;
  return score;
}
