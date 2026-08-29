# Learning services (`backend/services/learning`)

Pure policy + semantic contracts for Thompson mutation receipts.

## Authority split

| Layer | Role |
|-------|------|
| `agentsam_performance_eto_events` | Evidence — what happened |
| `backend/services/learning/reward-policy.js` | Pure decision — what that evidence means |
| `src/core/reward-events.js` | **Only** mutation gateway (D1 batch) |
| `agentsam_reward_events` | Immutable application receipt |
| `agentsam_routing_arms` | Accumulated learner state |

Worker bridge: `src/core/reward-policy-bridge.js`.

## Rules

- `deriveRewardPolicy()` — no D1, no arm lookup, no writes.
- Unclassified failures → `failure_category=unknown`, `bandit_eligible=0`, stored not punished.
- `cancelled_by_user`, `platform_request_error`, `budget_exceeded` → non-bandit by default.
- Legacy columns (`signal_type`, `signal_value`, `reason`) dual-written during transition.
- Triple-finalize collapse is **out of scope** until receipts explain themselves.

Migration: `migrations/1294_reward_events_semantic_v2.sql`.
