/**
 * R2 bucket list helpers — display names and aliases come from GET /api/r2/buckets
 * (`buckets` + `resolve`). Worker canonicalizes via resolveR2BucketName / resolveR2Access.
 */

export type R2BucketsApiResponse = {
  buckets?: string[];
  bound?: string[];
  resolve?: Record<string, string>;
};

export function pickR2BucketResolveMap(data: R2BucketsApiResponse): Record<string, string> {
  return data.resolve && typeof data.resolve === 'object' ? data.resolve : {};
}

/** Prefer server `buckets` (deduped); fall back to bound list. */
export function pickR2DisplayBuckets(data: R2BucketsApiResponse): string[] {
  if (Array.isArray(data.buckets) && data.buckets.length) return data.buckets;
  if (Array.isArray(data.bound) && data.bound.length) return data.bound;
  return [];
}

/** Map palette / legacy labels to the primary bucket name from the API. */
export function resolveR2BucketLabel(
  requested: string,
  displayBuckets: string[],
  resolveMap: Record<string, string>,
): string {
  const r = requested.trim();
  if (!r) return r;
  if (displayBuckets.includes(r)) return r;
  const fromMap = resolveMap[r] ?? resolveMap[r.toLowerCase()];
  if (fromMap && displayBuckets.includes(fromMap)) return fromMap;
  if (fromMap) return fromMap;
  const ci = displayBuckets.find((b) => b.toLowerCase() === r.toLowerCase());
  return ci ?? r;
}
