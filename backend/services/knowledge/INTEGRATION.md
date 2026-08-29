# Knowledge protocol — backend domain

Agent Sam **Semantic Knowledge + Experience + Learning** lives here.
Worker routes and finalization hooks import via
[`src/core/knowledge-protocol-bridge.js`](../../../src/core/knowledge-protocol-bridge.js)
(same seam pattern as [`memory-service-bridge.js`](../../../src/core/memory-service-bridge.js)).

## Layout

```
backend/services/knowledge/
  contract/packet.js      Model-neutral Knowledge Packet shape
  generation.js           workspace knowledge_generation counter
  retrieval.js            retrieveKnowledge()
  bootstrap.js            buildKnowledgeBootstrap()
  attribution.js          knowledge IDs used per agent_run
  experience/
    compile.js            agentsam_agent_experience writer
    score.js              deterministic reward/outcome
    curator.js            experience → agentsam_memory commit
```

## Four learning layers (do not blur)

| Layer | Store | Module |
|-------|-------|--------|
| Working context | chat / digest / compaction | `src/core/` (unchanged) |
| Semantic knowledge | `agentsam_memory` + pgvector | memory commit + this retrieval/bootstrap |
| Episodic experience | `agentsam_agent_experience` | `experience/compile.js` |
| Behavioral policy | `agentsam_reward_events` → arms | `applyRewardEvent()` only — never experience |

## Integration rules

1. **Experience never mutates Thompson** — compile runs after `applyRewardEvent`.
2. **Curator never raw-writes memory** — `executeAgentsamMemoryCommit()` only.
3. **D1 migrations** for `agentsam_agent_experience` stay in repo-root `migrations/` (control plane).
4. **Postgres service SQL** (if any) belongs in `backend/database/migrations/`.

## Public entrypoints (via bridge)

- `buildKnowledgeBootstrap(env, opts)` — session hydration packet
- `retrieveKnowledge(env, db, opts)` — ranked semantic retrieval
- `compileAgentExperience(env, agentRunId)` — post-finalize episodic row
- `curateKnowledgeFromExperience(env, exp)` — durable lesson promotion

## HTTP (Worker — stays in src/api/)

- `POST /api/internal/knowledge/bootstrap|search|commit`
- `POST /api/internal/agent-experience/finalize`
- `GET /api/analytics/learning/overview|experiences`
- `POST /api/agent/feedback`
