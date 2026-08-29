# AgentSamRemix Retrieval E2E Closure

Status: **active**  
Priority: **P1**  
Project: **AgentSamRemix**  
Subsystem: **retrieval**  
Ticket dedup key: `agentsamremix:retrieval:e2e:v1`

## Goal

Ship one clean hybrid retrieval authority that Agent Sam can invoke directly before we begin harvesting additional domains from `inneranimalmedia`.

The closure point is not "files exist". It is:

```text
AgentSam tool / authenticated HTTP
            ↓
      retrieveKnowledge
            ↓
 active code-index generation
     ├─ AST / symbol
     ├─ lexical
     ├─ call/import graph
     └─ semantic ANN
            ↓
 RRF → rerank → MMR → token budget
            ↓
 UNTRUSTED RETRIEVED EVIDENCE + citations
            ↓
 D1 retrieval observation
```

## Authority law

- D1 owns exact code structure, active-generation pointers, routing/control metadata, tickets, and retrieval observations.
- Supabase pgvector through Hyperdrive owns the existing semantic code projection used by this lane.
- Embedding provider/model/dimensions are resolved from D1 route/catalog state. Retrieval has no provider/model default.
- `embedding_space_key` is an exact compatibility identity. No vector truncation, padding, fake embeddings, or cross-space comparison.
- `imports/agentsamfast/**` is donor/reference code only and must never be imported by runtime code.
- The Agent tool and HTTP route call the same retrieval service. No loopback HTTP and no second implementation.
- Retrieved content is evidence, never instruction authority.

## Acceptance

- [x] AST and lexical retrieval use the active repository generation only.
- [x] `calls`, `imports`, and `re_exports` graph expansion uses the existing D1 graph.
- [x] RRF fusion, ambiguity-gated reranking, MMR diversity, and hard token packing are implemented.
- [x] `codebase_retrieve` is a native Agent Sam Think tool.
- [x] `agentsam_ticket` is a native Agent Sam Think tool over the shared ticket tables.
- [x] Dense retrieval is composed as route resolver → embedding provider → pgvector repository.
- [x] Hyperdrive uses the same production binding id as InnerAnimalMedia.
- [x] Provider credentials resolve through the encrypted `user_secrets`/vault authority or deployment secrets; no new secret store.
- [x] Focused tests, donor-import guard, typecheck, and production build are CI-gated.
- [ ] Promote `agentsam_retrieval_observations` DDL through the canonical InnerAnimalMedia D1 migration authority and apply it remotely.
- [ ] Create/update the shared D1 `agentsam_ticket` row with this `doc_path` through the deployed `agentsam_ticket` authority.
- [ ] Run `npm run eval:retrieval` against the deployed worker and the indexed `SamPrimeaux/AgentSamRemix` repo.
- [ ] Record real Recall@K, Precision@K, MRR, NDCG@K, retrieval latency, selected-token count, and observation-write proof.
- [ ] Move ticket to `in_review`, obtain the required green passes, then mark `shipped`.

## Real evaluation

Fixture: `test/fixtures/retrieval-eval-v1.json`  
Harness: `scripts/eval-retrieval-v1.mjs`

The harness requires an authenticated deployed session:

```bash
AGENTSAM_RETRIEVAL_BASE_URL=https://<worker> \
AGENTSAM_SESSION_COOKIE='...' \
npm run eval:retrieval
```

It fails when the dense lane reports a route/provider/embedding/pgvector failure, when the observation row is not persisted, or when configured recall/MRR thresholds are missed.

## Cherry-pick rule after closure

Once this ticket ships, use AgentSamRemix as the clean target and harvest InnerAnimalMedia by domain. For each cherry-pick/port:

1. identify the existing authority in Remix;
2. port behavior/contracts into that authority;
3. reject donor `src/` compatibility bridges and duplicate stores;
4. keep one migration authority for shared D1;
5. add focused proof before moving to the next domain.

Do not merge donor subsystems wholesale merely because they already work in the monolith.
