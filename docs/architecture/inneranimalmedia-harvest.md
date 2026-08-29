# InnerAnimalMedia → AgentSamRemix harvest ledger

Updated: 2026-08-29

InnerAnimalMedia is a donor/reference implementation. AgentSamRemix is the clean target.

## Transfer law

```text
contracts / types
  ↓
backend domain authority
  ↓
HTTP adapter
  ↓
browser API client
  ↓
UI/page
  ↓
tests + build gate
  ↓
delete duplicate / compatibility authority
```

AgentSamRemix browser/product code lives under `app/frontend/`. `dashboard` is a route/shell concept, not another frontend root.

Never copy a donor folder wholesale when it would create a second identity resolver, router, credential vault, model registry, browser-session authority, vector authority, or storage truth.

## Status legend

- **GREEN** — cohesive donor behavior with a clear Remix authority/destination.
- **YELLOW** — useful implementation, but donor coupling/legacy authority must be peeled during transfer.
- **RED** — donor migration residue or duplicate authority; do not port as architecture.
- **LANDED** — canonical Remix path is wired into the mounted/runtime product and gated.

## Ledger

| Capability | IAM donor | Remix destination | Status | Decision |
| --- | --- | --- | --- | --- |
| Browser Run live view | `app/agentsam/frontend/workbench/browser/**` + `backend/browser/**` | `app/frontend/browser/**` + Think `AgentSam` BrowserConnector | **LANDED in PR #6** | Keep the useful live-view UX, but **do not** reproduce IAM's second `BROWSER_SESSION`/job/trust router. Think AgentSam remains the sole Browser Run session authority. |
| Terminal setup browser client | dashboard PTY setup helper | `app/frontend/services/terminal/` | **LANDED in PR #6** | Browser-client behavior belongs under frontend; `app/dashboard/` is retired as a Remix source root. |
| Public/auth surfaces | `app/frontend/auth/**` | `app/frontend/auth/**` | **GREEN** | Same ownership model; audit identity endpoints before copying presentation changes. |
| Keys & Secrets settings | IAM settings UI + credentials domain | `app/frontend/components/settings/` + `app/backend/credentials/` + `app/backend/http/settings/` | **LANDED in PR #7** | `user_secrets` is the persisted BYOK authority and existing vault crypto is the encryption authority. Internal PTY/tunnel rows are outside the Settings domain. Gemini-only and parallel secret stores are retired. |
| Index Rules | IAM settings UI + code-index policy backend | `app/frontend/components/settings/` + `app/backend/agentsam/codebase/ignore-policy.js` | **LANDED in PR #7** | Reuses shared `agentsam_ignore_pattern`, requires exact GitHub repo authorization, fails loud on empty policy, and uses optimistic policy versions. |
| Chat/Work shell | IAM ChatAssistant/dashboard shell | `app/frontend/agent/` + `app/frontend/workbench/` | **YELLOW** | Harvest activity/provenance UX selectively; Remix Think chat/runtime stays authoritative. Avoid donor mission/demo runtimes. |
| Repository intelligence UI | IAM intelligence/code-index views | `app/frontend/intelligence/` | **YELLOW** | UI is useful once backed by Remix retrieval/repo-intelligence contracts; do not copy synchronous historian/indexer behavior into browser code. |
| Projects/tickets UI | IAM project/ticket surfaces | `app/frontend/projects/` | **YELLOW** | Reuse Remix ticket/domain authority first; then port browser client/UI. |
| Legacy `src/**` bridges | IAM migration/compat modules | none | **RED** | Inspect only to discover behavior/callers. Never make them permanent Remix dependencies. |
| IAM `BROWSER_SESSION` control plane | IAM browser DO/session router | none for current Remix Browser Run | **RED for Remix** | Remix already has a reusable BrowserConnector session inside the Think Agent. A second browser session owner would duplicate state. |

## Gate for the next slice

Before changing code, answer:

1. What is the donor's actual canonical authority?
2. Which donor files are only adapters, demos, or migration residue?
3. What tables, bindings, credentials, and workspace scope does it require?
4. What authority does Remix already have for those concerns?
5. Can the slice land without introducing a second source of truth?
6. What focused test proves the slice is complete?
7. What old/duplicate path becomes deletable when it lands?

If the answer to #5 is no, redesign the seam before copying code.

## Next candidates

After Keys & Secrets / Index Rules is green, prefer small visible slices with already-existing backend truth:

1. Real repository tree/file/diff Work surface over the existing execution/retrieval authorities.
2. Chat/Work activity timeline fed by real tool/file/terminal/browser events.
3. Projects/tickets browser surface over the existing ticket authority.

Take one at a time. Merge green. Then move to the next layer.
