/** Normalize Unix epoch to milliseconds (handles legacy second timestamps). */
export function normalizeEpochMs(ts: number): number {
  if (!Number.isFinite(ts)) return NaN;
  return ts < 1e12 ? ts * 1000 : ts;
}

export function parseHealthCheckEpochMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = normalizeEpochMs(value);
    return Number.isFinite(ms) ? ms : null;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export const TUNNEL_VERIFY_STALE_MS = 5 * 60 * 1000;

export function isEpochStale(tsMs: number | null, maxAgeMs = TUNNEL_VERIFY_STALE_MS): boolean {
  if (tsMs == null || !Number.isFinite(tsMs)) return true;
  return Date.now() - tsMs > maxAgeMs;
}
