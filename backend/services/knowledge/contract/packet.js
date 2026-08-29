/**
 * Model-agnostic Knowledge Packet contract — provider-neutral briefing shape.
 * Used by bootstrap, session hydration, and MCP/internal APIs.
 */

export const KNOWLEDGE_TYPES = Object.freeze([
  'fact',
  'decision',
  'policy',
  'procedure',
  'preference',
  'state',
  'event',
  'error',
]);

export const KNOWLEDGE_PACKET_SECTIONS = Object.freeze([
  'current_state',
  'decisions',
  'policies',
  'procedures',
  'facts',
  'preferences',
  'recent_evolution',
  'prior_experience',
  'warnings',
]);

/**
 * @param {Record<string, unknown>} partial
 * @returns {Record<string, unknown>}
 */
export function emptyKnowledgePacket(partial = {}) {
  return {
    ok: true,
    query: partial.query ?? null,
    scope: partial.scope ?? {},
    knowledge_generation: partial.knowledge_generation ?? null,
    bootstrap_id: partial.bootstrap_id ?? null,
    current_state: [],
    decisions: [],
    policies: [],
    procedures: [],
    facts: [],
    preferences: [],
    recent_evolution: [],
    prior_experience: [],
    warnings: [],
    refs: [],
    token_estimate: 0,
    ...partial,
  };
}

/**
 * @param {Record<string, unknown>} row
 * @param {number} relevance
 * @returns {Record<string, unknown>}
 */
export function knowledgeRefFromMemoryRow(row, relevance = 0.5) {
  const id = row?.memory_id || row?.id || null;
  const key = row?.key || row?.memory_key || null;
  return {
    id,
    key,
    type: row?.memory_type || row?.type || 'fact',
    title: row?.title || key || id,
    summary: row?.summary || (typeof row?.value === 'string' ? row.value.slice(0, 280) : null),
    provenance: row?.source || row?.source_type || 'agentsam_memory',
    importance: Number(row?.importance) || null,
    confidence: Number(row?.confidence) || null,
    created_at: row?.created_at ?? row?.updated_at ?? null,
    relevance,
  };
}

/**
 * Render packet as stable-prefix markdown for prompt assembly (L0–L4 layers).
 * @param {Record<string, unknown>} packet
 * @param {{ maxChars?: number }} [opts]
 */
export function formatKnowledgePacketForPrompt(packet, opts = {}) {
  const maxChars = Math.min(Math.max(Number(opts.maxChars) || 12000, 2000), 24000);
  const lines = ['## Semantic knowledge briefing'];
  if (packet.bootstrap_id) lines.push(`bootstrap_id: ${packet.bootstrap_id}`);
  if (packet.knowledge_generation != null) {
    lines.push(`knowledge_generation: ${packet.knowledge_generation}`);
  }

  const sections = [
    ['CURRENT STATE', packet.current_state],
    ['IMPORTANT DECISIONS', packet.decisions],
    ['ACTIVE POLICIES', packet.policies],
    ['KNOWN PROCEDURES', packet.procedures],
    ['FACTS', packet.facts],
    ['PREFERENCES', packet.preferences],
    ['RECENT EVOLUTION', packet.recent_evolution],
    ['RELEVANT PRIOR EXPERIENCE', packet.prior_experience],
    ['WARNINGS / TRAPS', packet.warnings],
  ];

  for (const [label, items] of sections) {
    if (!Array.isArray(items) || !items.length) continue;
    lines.push(`\n### ${label}`);
    for (const item of items.slice(0, 12)) {
      const title = item?.title || item?.key || item?.id || 'item';
      const body = item?.summary || item?.content || '';
      lines.push(`- **${title}**${body ? `: ${body}` : ''}`);
      if (item?.key) lines.push(`  ref: ${item.key}`);
    }
  }

  let text = lines.join('\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n… [truncated]`;
  return text;
}
