import { executeCatalogToolRuntime } from './catalog-execution-runtime.js';

export async function executeCatalogTool(env, row, config, input, runContext, credentials) {
  return executeCatalogToolRuntime(env, row, config, input, runContext, credentials);
}
