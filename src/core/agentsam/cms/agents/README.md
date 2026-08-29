# CMS Agents

This directory owns **CMS-specific agent semantics**, not the Agent Sam runtime.

The canonical CMS agent operates on the same domain model as the human editor:

`Site → Page → Section → Block`

It owns:
- canonical CMS task/scope normalization,
- canonical capability names,
- provider-produced proposal validation,
- approval metadata for publish/destructive operations,
- portable delegation/spawn thresholds,
- the CMS read → draft → publish → verify protocol.

It does **not** own provider SDKs, model routing, spawn persistence, D1 run rows, sessions, or Agent Sam's general tool loop. Those remain platform responsibilities injected through adapters.

`service.js` deliberately separates `propose()` from `execute()`. AI output is only a proposal until a canonical capability executor performs the operation. A requested capability list is enforced after model output so a model cannot expand its own authority.

`spawn-policy.js` answers *when CMS work should delegate*. The platform bridge in `src/core/cms-spawn-bridge.js` owns *how* Agent Sam persists and runs that delegation.
