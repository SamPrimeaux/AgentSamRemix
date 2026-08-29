export function buildR2ObjectUrl(bucket: string, key: string): string {
  return `/api/r2/buckets/${encodeURIComponent(bucket)}/object/${encodeURIComponent(key)}`;
}

export function buildR2FileMetaUrl(bucket: string, key: string): string {
  const qs = new URLSearchParams({ bucket, key });
  return `/api/r2/file?${qs}`;
}
