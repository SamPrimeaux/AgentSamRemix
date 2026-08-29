# Semantic Knowledge Protocol (SKP)

Agent Sam **knowledge + experience + learning** runtime law.

**Implementation:** `backend/services/knowledge/`  
**Worker bridge:** `src/core/knowledge-protocol-bridge.js`  
**Integration:** `backend/services/knowledge/INTEGRATION.md`

## Four layers (do not blur)

| Layer | Store | Owner |
|-------|-------|-------|
| Working context | chat / digest / compaction | `src/core/` |
| Semantic knowledge | `agentsam_memory` + pgvector | memory commit + knowledge retrieval |
| Episodic experience | `agentsam_agent_experience` | `experience/compile.js` |
| Behavioral policy | `agentsam_reward_events` → arms | `applyRewardEvent()` only |

Experience never mutates Thompson sampling directly. Curator never raw-writes
memory — `executeAgentsamMemoryCommit()` only.
