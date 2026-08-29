/**
 * Router barrel for the modular Worker.
 *
 * Production request flow:
 *   - `src/index.js` — session healing, canonical redirects, health, webhooks, R2 pages,
 *     OAuth, auth hooks, identity, `getAuthUser`, MCP / agent-execute pre-dispatch, dashboard gate
 *   - `src/core/production-dispatch.js` — `dispatchProductionDomainRoutes` (all post-middleware
 *     `/api` domain routing; single source of truth)
 *
 * New API routes: add them in `production-dispatch.js` only. Do not reintroduce a parallel
 * `handleRequest` tree here — that previously drifted from production and caused silent 404s.
 */

export {
  handleTunnelStatusGet,
  handleTunnelRestartPost,
  TUNNEL_STATUS_PATH,
  TUNNEL_RESTART_PATH,
  isTunnelStatusGetPath,
} from './tunnel-status.js';
export { dispatchProductionDomainRoutes, resolveRoute } from './production-dispatch.js';
