# AgentSamFast support snapshots

These two files are preserved support dependencies for backend modules harvested from
`imports/agentsamfast/app/backend/`.

They are **not** the production database or code-intelligence authority and are not
wired into the Cloudflare Worker. They remain here so the promoted embedding,
workflow, and RAG code can be inspected, typechecked, and selectively refactored
without importing runtime code from the donor tree.

- `database.ts` — snapshot of the donor's local Node/SQLite-compatible database helper.
- `repoHistorian.ts` — snapshot of the donor's repository-velocity prototype.

Before activating any promoted module in production, replace these legacy support
imports with the canonical runtime services under the real backend architecture.
