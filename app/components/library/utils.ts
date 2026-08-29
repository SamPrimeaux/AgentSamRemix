import type { ArtifactRecord } from '../../client-api/artifacts';

export function formatArtifactType(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return 'Unknown';
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function truncateMiddle(s: string, max = 36): string {
  const t = String(s || '');
  if (t.length <= max) return t;
  const keep = max - 3;
  const a = Math.floor(keep / 2);
  const b = keep - a;
  return `${t.slice(0, a)}…${t.slice(-b)}`;
}

export function typeBadgeClass(): string {
  return 'iam-lib-badge iam-lib-badge--type';
}

export function statusBadgeClass(kind: string, value: string | null | undefined): string {
  const v = String(value || '').toLowerCase();
  if (kind === 'artifact_status') {
    if (v === 'draft') return 'iam-lib-badge iam-lib-badge--muted';
    if (v === 'generated' || v === 'pending') return 'iam-lib-badge iam-lib-badge--cyan';
    if (v === 'approved') return 'iam-lib-badge iam-lib-badge--green';
    if (v === 'published' || v === 'deployed') return 'iam-lib-badge iam-lib-badge--violet';
    if (v === 'failed' || v === 'rejected') return 'iam-lib-badge iam-lib-badge--red';
    if (v === 'archived') return 'iam-lib-badge iam-lib-badge--muted';
    return 'iam-lib-badge iam-lib-badge--neutral';
  }
  if (kind === 'validation') {
    if (v === 'passed' || v === 'pass') return 'iam-lib-badge iam-lib-badge--green';
    if (v === 'partial') return 'iam-lib-badge iam-lib-badge--amber';
    if (v === 'failed' || v === 'fail') return 'iam-lib-badge iam-lib-badge--red';
    if (v === 'stale') return 'iam-lib-badge iam-lib-badge--orange';
    if (v === 'untested' || !v) return 'iam-lib-badge iam-lib-badge--amber';
    return 'iam-lib-badge iam-lib-badge--neutral';
  }
  if (kind === 'visibility') {
    if (v === 'public') return 'iam-lib-badge iam-lib-badge--cyan';
    if (v === 'private' || v === 'internal') return 'iam-lib-badge iam-lib-badge--muted';
    return 'iam-lib-badge iam-lib-badge--neutral';
  }
  return 'iam-lib-badge iam-lib-badge--neutral';
}

export function openArtifactPublic(a: ArtifactRecord) {
  if (a.public_url) window.open(a.public_url, '_blank', 'noopener,noreferrer');
  else if (a.preview_url) window.open(a.preview_url, '_blank', 'noopener,noreferrer');
}
