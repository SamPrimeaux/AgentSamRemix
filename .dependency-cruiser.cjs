/**
 * Architecture boundary enforcement.
 *
 * Permanent laws enforced here:
 *   1. app/** never imports backend/**.
 *   2. backend/** never imports app/**.
 *   3. packages/** never imports app/** or backend/** (must stay portable).
 *   4. No circular dependencies.
 *
 * backend/** -> root src/** is NOT enforced here on purpose: 303 existing
 * references make it a hard-fail-on-day-one rule that blocks every PR.
 * That edge is ratcheted instead by scripts/ratchet-backend-src.mjs, which
 * fails only when the count goes UP from a stored baseline. Once it hits
 * zero, promote it into this file as a real forbidden rule and delete the
 * ratchet script.
 */
module.exports = {
  forbidden: [
    {
      name: 'app-must-not-import-backend',
      severity: 'error',
      comment: 'Frontend and backend communicate only through the HTTP API, never through source imports.',
      from: { path: '^app' },
      to: { path: '^backend' },
    },
    {
      name: 'backend-must-not-import-app',
      severity: 'error',
      comment: 'Server-side code must not depend on browser-only code.',
      from: { path: '^backend' },
      to: { path: '^app' },
    },
    {
      name: 'packages-must-stay-portable',
      severity: 'error',
      comment: "packages/* must be reusable by other apps/customers -- it cannot depend on this deployment's app/ or backend/.",
      from: { path: '^packages' },
      to: { path: '^(app|backend)' },
    },
    {
      name: 'no-circular',
      severity: 'warn',
      comment: 'Circular dependencies make the reachability graph meaningless. Warn-only for now -- pre-existing debt, separate cleanup from the app/backend boundary.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^app/dist' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
