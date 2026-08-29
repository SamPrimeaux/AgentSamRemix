# CMS agent tools (canonical)

This folder is the Agent Sam **tool surface** for CMS: one handler per atomic capability (or explicit workflow tools that stay off `cms_edit`).

```text
agentsam_tools (handler_type=cms)
  → catalog-tool-surfaces.js
  → src/core/agentsam/cms/tools/handlers.js
  → pages/sections/blocks/runtime + adapters
```

`src/tools/builtin/cms.js` is a **compat re-export only**. Do not add logic there.

Temporary imports of `src/core/cms-*.js` host helpers are peel debt (see `dependency-policy.json`). Move those into adapters/lifecycle next — do not grow new logic against them.
