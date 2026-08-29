# Codebase index — backend domain

Structural parse client + symbol materialization for AST-RAG / full index.
WASM parse runs on **SamPrimeaux/iam-codebase-indexer-service** (`IAM_CODEBASE_INDEXER` binding).

The main Worker calls this service directly from the backend codebase domain. No
tree-sitter runtime or compatibility shim lives in the main Worker.

## Layout

```
backend/agentsam/codebase/
  structural-parse.js   parser IDs, materializeStructuralSymbols, parseStructuralForFile
  indexer-client.js     IAM_CODEBASE_INDEXER binding client (/parse, /warm)
```

Contract fixtures: `tests/support/codebase-indexer-local/`.

## Deploy

Indexer Worker: standalone repo only — not a monorepo `services/` mirror.
