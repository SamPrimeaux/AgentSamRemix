/**
 * Worker bridge: src/ routes + finalization hooks ↔ backend/services/knowledge.
 * Domain logic lives under backend/ — same pattern as memory-service-bridge.js.
 */
export {
  KNOWLEDGE_TYPES,
  KNOWLEDGE_PACKET_SECTIONS,
  emptyKnowledgePacket,
  knowledgeRefFromMemoryRow,
  formatKnowledgePacketForPrompt,
} from '../../backend/services/knowledge/contract/packet.js';

export {
  getKnowledgeGeneration,
  bumpKnowledgeGeneration,
  classifyKnowledgeScopeLayer,
} from '../../backend/services/knowledge/generation.js';

export { retrieveKnowledge } from '../../backend/services/knowledge/retrieval.js';
export { buildKnowledgeBootstrap } from '../../backend/services/knowledge/bootstrap.js';

export {
  recordKnowledgeUseForRun,
  getKnowledgeUseForRun,
  clearKnowledgeUseForRun,
  persistKnowledgeRefsOnRun,
} from '../../backend/services/knowledge/attribution.js';

export {
  classifyExperienceOutcome,
  scoreAgentExperience,
  estimateCacheSavingsUsd,
} from '../../backend/services/knowledge/experience/score.js';

export {
  deriveKnowledgeCandidatesFromExperience,
  curateKnowledgeFromExperience,
} from '../../backend/services/knowledge/experience/curator.js';

export {
  resolveExperienceSurface,
  compileAgentExperience,
  compileAgentExperienceFromMcpSpine,
} from '../../backend/services/knowledge/experience/compile.js';
