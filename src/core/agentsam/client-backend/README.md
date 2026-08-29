# Client Backend

Portable server-side capabilities used by client-hosted products.

This domain is intentionally separate from `@inneranimalmedia/client-core`: client-core owns renderer-independent client transport/state, while this domain owns backend media and migration semantics. The `src/core/agentsam/` path is a product namespace under the repository dependency law; it does not mean Agent Sam owns the product.

## Current boundary

```text
src/core/agentsam/client-backend/
  media/
    contracts.js        canonical Asset + AssetUsage shapes
    identity.js         source URL normalization and identity hints
  ingest/
    contracts.js        website-ingest request/policy contract
    srcset.js           responsive image candidate parsing
```

The first extraction is deliberately pure. It does not know HTTP routes, D1 column layouts, R2 bindings, IAM dashboard components, Cloudflare credentials, or Legendary-specific names.

Adapters and persistence should be added only after the existing IAM R2/media infrastructure is peeled behind these contracts. CMS should consume asset IDs/descriptors through a port; CMS does not own binary download, hashing, optimization, or physical storage.

A future package graduation may expose this domain as `@inneranimalmedia/client-backend`. Do not create a parallel media implementation inside a client repo merely to obtain that package shape.
