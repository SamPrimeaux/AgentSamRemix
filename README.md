# Agent Sam Workbench (codename: AgentSamRemix)

An authenticated operator client for Agent Sam: inspect, edit, test, verify,
and refactor real repositories — starting with `SamPrimeaux/inneranimalmedia`.

> **Status: pre-implementation spec.** This repo starts empty. Everything in
> this README describes the *target* shape, not a working system. Nothing
> here has real auth, a real SDK connection, or a real execution backend
> wired up yet — those get built in the order under [Build Order](#build-order),
> and each box only gets checked once it's true against actual code, not
> against what a prototype narrated.

## What this is

A **mission-driven engineering workbench**, not an IDE clone. The unit of
work is a **Mission** — a plain-language engineering task — and the product
takes it through:

```
Mission → repository context → plan → tool execution loop →
files changed → tests → browser verification →
reviewable diff → commit / PR (only on explicit approval)
```

Monaco is a window into a mission's diff, not the product itself.

## What this is *not*

- Not a second auth system. Auth is owned by `@inneranimalmedia/agentsam-sdk`
  identity module — this app is a consumer, never a duplicate authority.
- Not a fork of the InnerAnimalMedia backend. Tool catalog, telemetry,
  browser automation, terminal execution, and model routing are all owned
  upstream; this app calls them through explicit adapters.
- Not a benchmark dashboard. Environment comparison (Cloudflare vs. other
  execution backends) is an advanced diagnostics panel, not the product
  identity.

## Non-negotiable, day zero

Install these *before* the codebase has anything worth breaking — retrofitting
them after 500k lines is a much worse day, ask me how I know:

- [x] A dependency-layer guard (`scripts/guard-dependency-law.mjs`)
      enforcing a strict import direction from commit #1.
      Reference shape: `platform → shared → identity → domain → composition`,
      each layer may only import downward. Fail CI on violation, not warn.
- [ ] `.env.example` is the only place secret *names* live. No default values
      for anything real. No ID ever hardcoded in source — see
      `.env.example` for the exact list.
- [ ] One auth authority, decided before the second route is written:
      `@inneranimalmedia/agentsam-sdk/identity`. If a seam is missing, the
      fix is a PR to the SDK, not a local auth shim in this repo.

## Architecture

```
Browser (React + Vite)
  application shell, Monaco, mission composition,
  execution stream, diff view, browser-preview iframe,
  approvals UI
        │  (fetch — no infra credentials ever reach this layer)
        ▼
Cloudflare Worker (this repo's worker/)
  authN/authZ boundary, secrets, D1/KV/R2/DO bindings,
  thin host adapters to MCP / GitHub / Agent Sam tool execution,
  approval enforcement, telemetry writes
        │
        ▼
@inneranimalmedia/agentsam-sdk  (external dependency, never vendored)
  identity contracts • repository intelligence • portable
  execution-environment contracts • reusable Agent Sam capabilities
        │
        ▼
InnerAnimalMedia host infrastructure / MCP / real repositories
```

### Mission lifecycle

```
created → preparing → inspecting → planning → executing →
verifying → review_ready → completed
                 ↘ failed / cancelled (from any state)
```

A mission is not assumed to finish in 3–5 tool calls. The execution loop is
`inspect → reason → act → observe → adjust → verify`, repeated until the
mission's own gates pass.

### Execution environments (pluggable, not hardcoded)

```ts
interface ExecutionEnvironment {
  id: string;
  name: string;
  status: 'offline' | 'starting' | 'ready' | 'busy' | 'error';
  capabilities: {
    filesystem: boolean;
    terminal: boolean;
    browser: boolean;
    network: boolean;
    git: boolean;
    isolated: boolean;
  };
  prepare(): Promise<void>;
  exec(cmd: string, opts?: ExecOptions): Promise<ExecutionResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  dispose?(): Promise<void>;
}
```

The mission layer never knows or cares which backend it's running on. Local,
sandbox container, remote VM — same contract. Add a new environment by
implementing this interface, not by branching mission logic on a provider name.

### Typed execution events

The execution ledger UI consumes events; it does not maintain its own
parallel state:

```
environment.preparing / environment.ready
mission.started / mission.plan.updated / mission.completed
repository.search / repository.read
tool.started / tool.completed / tool.failed
file.edited
terminal.started / terminal.output / terminal.completed
test.started / test.completed
browser.started / browser.verified
verification.started / verification.passed / verification.failed
artifact.created
```

Default view: compact, one line per event. Click to expand into command,
cwd, environment, stdout/stderr, exit code, duration, related files, receipt ID.
Never permanently dump raw terminal logs into the main view.

### Safety model

Every tool call is classified before it runs:

| Class | Behavior |
|---|---|
| `READ` | Default. No gate. |
| `WRITE` | Logged to the execution receipt. |
| `EXECUTE` | Logged, environment-scoped. |
| `EXTERNAL_EFFECT` | Requires explicit approval — pauses the mission. |
| `DESTRUCTIVE` | Requires explicit approval — pauses the mission. |

`git push`, merge, deploy, DB mutation, secret change, production write, and
any external send are always `EXTERNAL_EFFECT` or `DESTRUCTIVE`. Never fake
an approval by continuing silently. Every meaningful tool call gets a
receipt — no exceptions, this is the audit trail.

## Auth (real, not decorative)

```
/  →  authenticated? → no  → /auth/login
                      → yes → /dashboard/workbench
```

- `GET /api/auth/me` is the *only* source of truth for "am I logged in."
  A client-side `isLoggedIn` boolean is not authentication.
- Login/signup/logout/session/password-reset/OAuth all come from
  `@inneranimalmedia/agentsam-sdk/identity` — `createIdentityClient`,
  `createIdentityService`, `createCloudflareD1Adapter`,
  `handleIdentityWorkerRequest`. If a route this app needs doesn't exist in
  the SDK yet, that's a seam to fill upstream, not a reason to build a local
  auth screen backed by `localStorage`.
- Default OAuth lane: InnerAnimalMedia IAM. Google/GitHub BYOK supported
  when the developer has credential pairs configured.

## Repo layout (target)

```
AgentSamRemix/
├── src/                    # React + Vite frontend
│   ├── components/
│   │   ├── auth/
│   │   ├── workbench/       # mission composer, execution ledger, diff view
│   │   ├── editor/          # Monaco wrapper — theme-inherited, reusable
│   │   ├── bindings/        # Cloudflare bindings settings surface
│   │   └── intelligence/    # repository intelligence view
│   └── App.tsx
├── worker/                  # Cloudflare Worker — the real auth/secrets boundary
│   ├── index.ts             # fetch handler, route table
│   ├── routes/
│   └── adapters/             # thin adapters to SDK, MCP, GitHub
├── scripts/
│   └── guard-dependency-law.mjs
├── .env.example
├── wrangler.jsonc
└── package.json
```

## Build order

Work in this order. Do not build UI for a contract that doesn't exist yet.

1. Install `@inneranimalmedia/agentsam-sdk`, wire real identity Worker routes.
2. Auth boundary: login/session/logout/refresh, `/dashboard/workbench` gate.
3. Repository Workspace contract (repo, branch, working-tree status, active mission).
4. Mission object + lifecycle states (no fake UI states — SDK is the source of truth).
5. Execution environment abstraction (start with exactly one real backend).
6. Execution ledger wired to real typed events (delete any mock event stream).
7. Monaco wired to real repository files via SDK filesystem APIs.
8. Repository intelligence panel wired to `agentsam_sdk.repository.intelligence`.
9. Browser verification wired to a real preview + real Browser Run/equivalent.
10. Approval gates wired to real `EXTERNAL_EFFECT`/`DESTRUCTIVE` pauses.
11. Mission persistence/recovery across reload.
12. Remove every remaining mock. If a panel has no real data source yet, it's
    not in the nav — it's a TODO in this README.

## Definition of done (v0 vertical slice)

- [ ] Sign out → redirected to real IAM login.
- [ ] Sign in via real IAM OAuth.
- [ ] Refresh page → session restored, `/api/auth/me` confirms identity.
- [ ] Connect `SamPrimeaux/inneranimalmedia`.
- [ ] Run repository intelligence → real data, not a canned health score.
- [ ] Create a mission → watch real tool execution, not a scripted ledger.
- [ ] Open/edit a real file in Monaco, see a real diff.
- [ ] Run tests in a real environment, see real pass/fail counts.
- [ ] Trigger a `DESTRUCTIVE` action → mission actually pauses for approval.
- [ ] Reload mid-mission → mission state recovers.

If any box is checked because a prototype *said* it happened rather than
because it's reproducible against real code, it's not done — uncheck it.

## Local dev

```bash
npm install
cp .env.example .env.local   # fill in real values, never commit this file
npm run dev                  # vite dev server + wrangler dev, side by side
npm run typecheck
npm run test
npm run guard                 # dependency-layer check — also runs in CI
npm run build
npm run deploy                # wrangler deploy — production Worker
```

## Relationship to other repos

- **`agentsam-sdk`** — the canonical, portable dependency. Identity,
  repository intelligence, execution-environment contracts. This app
  consumes its public exports/subpath exports only. Never vendor SDK source
  into this repo. Local dev may use `npm link`; deployment pins an exact
  version.
- **`inneranimalmedia`** — owns the real host infrastructure this workbench
  eventually operates on (tool catalog, telemetry, browser/terminal
  authority, model routing). This repo is a client + thin host Worker, not
  a second implementation of any of that.
