# RAG

`backend/rag/` is the shared online retrieval-augmented generation runtime.

It owns the production path for semantic retrieval, embedding-route resolution,
workspace/vector scope, lane resolution, ranking/fusion, and pgvector/Vectorize
query behavior. Agent Sam, CMS, Mail, Learn, Projects, Work, and other product
domains may consume this capability; none should grow a second RAG implementation.

This directory is intentionally for **online request/runtime behavior**. Heavy
offline work such as repository intelligence, dataset construction, temporal
validation, off-policy evaluation, and large statistical reports belongs under
`tools/` and should run on the Mac/VPS/sandbox rather than the Worker request path.

Retired competing owners:

- `backend/knowledge/`
- `backend/agentsam/rag/`
- `backend/embeddings/`
