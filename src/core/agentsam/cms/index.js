/**
 * Public CMS product facade.
 *
 * Consumers import namespaces (`pages`, `sections`, `blocks`, …), not internals.
 * Domain `index.js` barrels that re-export normalize helpers are intentionally
 * not used here. Adapters, D1/R2 stores, cache keys, and legacy serializers
 * stay private — import those from their modules, never from this file.
 */

export * as pages from './pages/service.js';
export * as sections from './sections/service.js';
export * as blocks from './blocks/service.js';
export * as assets from './assets/service.js';
export * as routing from './routing/cms-route.js';
export * as context from './context/public.js';
export * as bootstrap from './bootstrap/public.js';
export * as runtime from './runtime/descriptor.js';
export * as preview from './preview/service.js';
export * as lifecycle from './lifecycle/public.js';
export * as pipeline from './pipeline/publish.js';
export * as templates from './templates/service.js';
export * as packages from './packages/public.js';
export * as contracts from './contracts/capabilities.js';
export * as registry from './registry/index.js';
export * as agents from './agents/service.js';
export * as ai from './ai/service.js';
