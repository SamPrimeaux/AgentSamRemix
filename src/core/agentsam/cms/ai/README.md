# CMS AI

This directory is provider-neutral.

CMS AI receives a canonical CMS task and returns a structured operation proposal. It never imports OpenAI, Anthropic, Google, Workers AI, or any other provider SDK.

The platform adapter `src/core/cms-ai-runtime.js` resolves the active model from Agent Sam's catalog/router and dispatches it through the existing provider runtime. The same CMS contract therefore works regardless of which supported model/provider is selected.

The portable interface is intentionally small:

```text
CMS task
  ↓
provider.complete(...)
  ↓
validated CMS proposal
```

Provider selection, credentials, streaming protocol, billing, failover, and model metadata stay outside CMS core.
