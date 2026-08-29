# CMS bootstrap domain

This directory owns the canonical CMS editor/site bootstrap payload.

It consumes canonical CMS context, loads the structured CMS data needed to initialize an editor,
assembles the site manifest, hydrates optional draft/live-session state, and coordinates bootstrap
cache reads/writes.

## Owns

- CMS project/site resolution for bootstrap
- bootstrap cache key + TTL
- D1 reads for pages, sections, components, themes, navigation, templates, imports, settings, and 3D assets
- grouping/normalization of section and component payloads
- active theme + site override assembly
- optional focused-page draft/live-session state
- site/home/storage manifest assembly
- final bootstrap response contract/orchestration

## Does not own

- HTTP request/response transport
- provider-specific AI behavior
- customer-specific defaults
- Cloudflare binding names or deployment identity
- legacy storefront/theme/site helper implementations

Temporary host capabilities are injected through the bootstrap adapter contract. As those legacy
capabilities are peeled into canonical CMS domains, the adapter implementations should move with
them; `bootstrap/` must not import old `src/core/cms-*` implementations directly.
