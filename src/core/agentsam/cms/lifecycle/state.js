const STATES = new Set(['draft','published','archived']);
export function normalizeCmsLifecycleState(value) {
  const v = String(value || '').trim().toLowerCase();
  return STATES.has(v) ? v : 'draft';
}
export function canCmsLifecycleTransition(from, to) {
  const a = normalizeCmsLifecycleState(from), b = normalizeCmsLifecycleState(to);
  if (a === b) return true;
  if (a === 'archived') return b === 'draft';
  if (b === 'archived') return true;
  return (a === 'draft' && b === 'published') || (a === 'published' && b === 'draft');
}
export function cmsLifecyclePurgePolicy(page, options = {}) {
  const state = normalizeCmsLifecycleState(page?.status);
  const archivedAt = Number(page?.archived_at || 0);
  const now = Number(options.now || Math.floor(Date.now()/1000));
  const retentionSeconds = Math.max(0, Number(options.retentionSeconds ?? 30*24*60*60));
  if (state !== 'archived') return { allowed:false, reason:'archive_required' };
  if (!archivedAt) return { allowed:false, reason:'archived_at_required' };
  if (now - archivedAt < retentionSeconds) return { allowed:false, reason:'retention_window', eligible_at: archivedAt + retentionSeconds };
  return { allowed:true, reason:null, eligible_at: archivedAt + retentionSeconds };
}
