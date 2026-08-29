/**
 * Thompson sampling — Beta(α, β) draw via normal approximation.
 * Marsaglia-Tsang / Box-Muller style; O(1), safe for Workers.
 */

/**
 * @param {number} alpha - success count + 1 (prior)
 * @param {number} beta  - failure count + 1 (prior)
 * @returns {number} sample in (0.001, 0.999)
 */
export function betaSample(alpha, beta) {
  const a = Math.max(0.1, Number(alpha) || 1);
  const b = Math.max(0.1, Number(beta) || 1);
  const sum = a + b;
  const mean = a / sum;
  const std = Math.sqrt((a * b) / (sum * sum * (sum + 1)));
  const u1 = Math.max(1e-10, Math.random());
  const u2 = Math.random();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0.001, Math.min(0.999, mean + std * normal));
}
