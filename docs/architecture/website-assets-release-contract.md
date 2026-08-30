# WEBSITE_ASSETS release contract

`WEBSITE_ASSETS` is the R2 authority for browser HTML shells. It is intentionally separate from Cloudflare Workers Assets, which transports compiled JS/CSS/PWA output.

## Storage contract

Payload bytes are content-addressed and immutable:

```text
objects/sha256/<first-two>/<sha256>.html
```

Release manifests are immutable:

```text
manifests/sha256-<release-hash>.json
```

There is exactly one mutable authority pointer:

```text
current.json
```

`current.json` contains the active logical-key map and the immutable manifest key. Promotion is one R2 write after all referenced payloads have been hash-verified. Rollback is another `current.json` promotion; payloads are not rewritten. The Worker exposes `X-IAM-Website-Release` and `X-IAM-Content-SHA256` on shell responses. A strong SHA-256 `ETag` is emitted as a best-effort HTTP validator, but Cloudflare HTML transformations may strip it at the edge.

## Logical keys

The contract lives in `config/website-assets.json`:

```text
index.html           build-coupled Vite output
site/home.html       direct authored HTML
auth/login.html      direct authored HTML
auth/signup.html     direct authored HTML
auth/reset.html      direct authored HTML
cms/studio.html      direct authored HTML
```

Only `index.html` requires a Vite build. The other five publish directly from `app/frontend/public/**`.

## Operator commands

```bash
bin/agentsam website sync
bin/agentsam website watch
bin/agentsam website status
bin/agentsam website verify --strict
bin/agentsam website rollback <release>
```

`website sync` hashes the direct sources, preserves the current build-coupled `index.html`, and writes R2 only when content changes. If the complete logical release is unchanged, it performs no payload upload and does not rewrite `current.json`.

Frontend deploys use `bin/website-assets.mjs sync --all`, which is the same publisher with `--all` after Vite has generated `app/dist/index.html`.

Worker-only deploys do not publish HTML.

## Regression rule

`npm run guard:website-assets` must pass in CI. Do not restore mutable top-level HTML objects as runtime authority, do not make direct HTML depend on `app/dist`, and do not introduce a second website-shell manifest.
