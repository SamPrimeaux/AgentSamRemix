/**
 * CMS agent tool catalog surface — lives in the canonical CMS scaffold.
 * Catalog dispatch loads `handlers` from here (not tools/builtin).
 */
export { handlers } from './handlers.js';
export { pipelineHandlers } from './pipeline.js';
export { sitePackageHandlers } from './site-package.js';
