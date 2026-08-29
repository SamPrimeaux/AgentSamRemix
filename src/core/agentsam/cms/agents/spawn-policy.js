/** Portable CMS delegation policy. No platform spawn persistence lives here. */
export const CMS_SPAWN_SECTION_THRESHOLD = 8;
export const CMS_SPAWN_PAYLOAD_BYTES = 32768;
export const CMS_SPAWN_SESSION_TURN_THRESHOLD = 3;

export function cmsDraftPayloadBytes(draftData) {
  try { return new TextEncoder().encode(JSON.stringify(draftData || {})).byteLength; }
  catch { return 0; }
}

export function cmsDraftSectionCount(draftData) {
  if (!draftData || typeof draftData !== 'object') return 0;
  const sections = draftData.sections;
  return sections && typeof sections === 'object' ? Object.keys(sections).length : 0;
}

export function cmsExceedsSpawnThreshold(opts = {}) {
  const sections = Number(opts.sectionCount) || 0;
  const bytes = Number(opts.payloadBytes) || 0;
  if (sections >= CMS_SPAWN_SECTION_THRESHOLD) return { spawn: true, reason: 'section_count', value: sections };
  if (bytes >= CMS_SPAWN_PAYLOAD_BYTES) return { spawn: true, reason: 'payload_bytes', value: bytes };
  if (opts.importName) return { spawn: true, reason: 'template_import', value: String(opts.importName) };
  return { spawn: false, reason: null, value: 0 };
}

export function cmsShouldHandoffSession(turnCount) {
  const turns = Math.max(0, Number(turnCount) || 0);
  return { spawn: turns >= CMS_SPAWN_SESSION_TURN_THRESHOLD, reason: turns >= CMS_SPAWN_SESSION_TURN_THRESHOLD ? 'turn_count' : null, value: turns };
}
