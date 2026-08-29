# /backend/database

Shared backend schema home for the **Supabase / pgvector** lane.

D1 SQL stays at repo-root `migrations/`. Peel a domain to `backend/` and its
D1 tables still migrate there. Do not mix the two.

| Store | SQL home |
|---|---|
| D1 (`env.DB`) | `migrations/NNNN_*.sql` |
| Postgres (`env.HYPERDRIVE`) | this folder **and** `supabase/migrations/` |

Apply memory SQL through the canonical Supabase lane:

  backend/database/migrations/20260822_agentsam_memory_gemini2_1536.sql
  supabase/migrations/20260822120000_agentsam_memory_gemini2_1536.sql

That file is additive. It does not recreate `agentsam.agentsam_memory`.
Type alignment (procedure|event): `20260823_agentsam_memory_type_commit_align.sql`
No backfill is included.

## Agent tool catalog lanes

Database tool discovery is catalog-driven. Do not add a parallel
`backend/database/tools/` registry: the live `agentsam_tools` rows are the
source of truth and `agentsam_search_tools` performs ranked discovery.

`tool_category` is semantic discovery metadata:

```text
database.d1.query
database.d1.write
database.d1.delete
database.supabase.query
database.supabase.write
database.supabase.vector
```

Keep the fields separate:

- `tool_category` says which data-source/operation family the tool belongs to.
- `handler_type` says which executor handles it.
- permissions and capabilities decide whether the caller may invoke it.
- `tool_name` and `input_schema` define how the model calls it.

The catalog guard is available as
`bin/agentsam guard catalog --remote --database <name-or-id>`. It validates
live active database rows without introducing a D1 query helper or a second
tool registry. There is no implicit primary-database fallback; alternatively,
set `D1_DATABASE_NAME` explicitly.
