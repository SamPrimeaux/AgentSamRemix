# usage-reconcile

Multi-provider usage reconciliation. Provider-agnostic core, thin per-provider
adapters. See tkt_2b26bcee109f469b (root bug) and tkt_6a6aed6ee8ea4e88 (this
feature) for full history.

## Three-tier ground truth (found 2026-08-01)

For the same provider/model/day, three numbers exist and disagree:

  Console/Admin API total  (truth)
      >  agentsam_agent_run total     (dispatch-time record)
          >  agentsam_usage_events total  (post-stream write, canonical writer)

Anthropic Aug 1 example: Console ~850k tokens, agent_run 647k, usage_events 528k.
This means events are dying somewhere between dispatch and the post-stream
writeUsageEvent() call (see usage-event-writer.js comment: "call once per AI
model invocation after streaming completes" -- a stream that errors before
completion never reaches the writer).

agent_run also retains far longer than usage_events (weeks vs ~2 days observed),
so it's independently useful even outside reconciliation.

## Layers

- provider-reconcile.js  -- Layer 1: Console/Admin API vs agentsam_usage_events
- agent-integrity.js     -- Layer 2: agentsam_agent_run vs agentsam_usage_events
                            (internal-only, no external API calls, pinpoints
                            WHERE in the pipeline events are lost)

## Provider status (researched 2026-08-01)

| provider | API calls | Runtime secret(s) |
| --- | --- | --- |
| `anthropic` | `GET https://api.anthropic.com/v1/organizations/usage_report/messages` (`group_by[]=model`) and `GET https://api.anthropic.com/v1/organizations/cost_report` | `ANTHROPIC_ADMIN_KEY` |
| `openai` | `GET https://api.openai.com/v1/organization/usage/completions?group_by=model` and `GET https://api.openai.com/v1/organization/costs` | `OPENAI_ADMIN_KEY` |
| `workers_ai` | `POST https://api.cloudflare.com/client/v4/graphql`, dataset `aiInferenceAdaptiveGroups` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `google` | BigQuery jobs.query on Cloud Billing **detailed** export (`adapters/google/`) | `GOOGLE_BILLING_SA_JSON` (or `GOOGLE_APPLICATION_CREDENTIALS` path locally); optional `GCP_BILLING_PROJECT` / `GCP_BILLING_DATASET` / `GCP_BILLING_TABLE_PREFIX` |

Missing Admin/SA secrets → `adapter_error` (never synthetic zero-usage success).
DeepSeek is permanently excluded (no per-day/model usage API).

**Google defaults:** project `gen-lang-client-0684066529`, dataset `billing_export`,
table prefix `gcp_billing_export_resource_v1_`. SA: `iam-billing-reader@…`.
Cost is authoritative from export; token in/out is best-effort when `usage.unit`
looks like tokens. Empty export tables fail loud until Google fills them.

Anthropic/OpenAI persist model token rows + one `__provider_total__` for USD.
Workers AI GraphQL: tokens only (`cost_usd` 0). Google: SKU→model labels +
`__provider_total__` cost from BQ.

Run a one-day pull locally with
`npm run reconcile:usage-providers -- --day=YYYY-MM-DD`. The script loads
runtime secrets through `scripts/with-cloudflare-env.sh`, and writes through
the Cloudflare D1 API after migration 1091 is applied.

## Provider list source of truth

Read providers from agentsam_model_catalog.provider (confirmed matches
agentsam_usage_events.provider exactly). NEVER read from provider_colors --
that table is UI-display-only, uses different slugs (anthropic_api vs
anthropic, google_antigravity vs google), and has no deepseek row at all.

## Size ceilings (enforce in review, do not let this balloon)

adapters/base.js        <= 30 lines
adapters/anthropic.js   <= 80 lines
adapters/workers-ai.js  <= 80 lines
adapters/openai.js      <= 90 lines
adapters/google/*       subdirectory (auth/query/index) — JWT + BQ REST
provider-reconcile.js   <= 150 lines (only file allowed real branching logic)
agent-integrity.js      <= 120 lines
index.js                <= 60 lines (orchestration only, no business logic)
schema.sql              <= 40 lines
