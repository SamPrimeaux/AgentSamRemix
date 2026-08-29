# CMS package/import domain

This directory owns portable package mechanics:

- archive extraction
- deterministic hashing
- theme template planning
- package inventory manifests
- deterministic theme artifact generation

It must not know a customer, deployment domain, Cloudflare binding, D1 database, R2 bucket, or AI provider. Host-specific upload, registry, pipeline-service and audit persistence live under `../adapters/cloudflare/`.
