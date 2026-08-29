export function formatModifiedLabel(raw?: string | null): string {
  if (!raw) return 'Recently';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return 'Recently';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return 'Today';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

export function formatBytes(raw?: number | string | null): string {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function folderDisplayName(prefix: string): string {
  const trimmed = prefix.replace(/\/+$/, '');
  if (!trimmed) return '';
  const parts = trimmed.split('/');
  return parts[parts.length - 1] || trimmed;
}

export function r2ParentPrefix(prefix: string): string {
  if (!prefix) return '';
  const trimmed = prefix.replace(/\/+$/, '');
  if (!trimmed) return '';
  const i = trimmed.lastIndexOf('/');
  return i < 0 ? '' : `${trimmed.slice(0, i + 1)}`;
}
