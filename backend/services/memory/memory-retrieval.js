import {
  MEMORY_CANDIDATE_MULTIPLIER,
  MEMORY_MAX_CANDIDATES,
} from './constants.js';
import { nowUnix, shouldExpire } from './memory-policy.js';
import { dedupeByContentHash, rankMemoryCandidate } from './memory-ranking.js';

/**
 * query → embed → candidate retrieval → scope filter → rank → dedupe
 */
export async function retrieveMemories({
  store,
  embedding,
  search,
  now = nowUnix(),
}) {
  const queryEmbedding = await embedding.embedQuery(search.query);
  const candidateLimit = Math.min(
    MEMORY_MAX_CANDIDATES,
    search.limit * MEMORY_CANDIDATE_MULTIPLIER,
  );

  const candidates = await store.search({
    workspaceId: search.workspaceId,
    queryEmbedding,
    limit: candidateLimit,
    subjectId: search.subjectId,
    memoryType: search.memoryType,
    minConfidence: search.minConfidence,
    includeExpired: search.includeExpired,
    nowUnix: now,
  });

  const scoped = [];
  for (const row of candidates) {
    if (!row || row.workspace_id !== search.workspaceId) continue;
    if (row.is_active === false) continue;
    if (!search.includeExpired && shouldExpire(row, now)) continue;
    scoped.push({
      ...row,
      rank_score: rankMemoryCandidate(row, now),
    });
  }

  scoped.sort((a, b) => b.rank_score - a.rank_score);
  return dedupeByContentHash(scoped).slice(0, search.limit);
}
