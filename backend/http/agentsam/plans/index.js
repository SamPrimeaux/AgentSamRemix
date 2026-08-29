/** Plan-family dispatcher. */

import { handlePlanIntakeRoute } from './intake.js';
import { handlePlanRevertRoute } from './revert.js';
import { handlePlanRefineRoute } from './refine.js';
import { handlePlanSaveRoute } from './save.js';
import { handlePlanExecuteRoute } from './execute.js';
import { handlePlanTaskResumeRoute } from './resume.js';

export async function handleAgentPlanRoutes(request, url, env, ctx, identity, services = {}) {
  const intake = await handlePlanIntakeRoute(request, url, env, ctx, identity, services);
  if (intake) return intake;
  const revert = await handlePlanRevertRoute(request, url, env, ctx, identity, services);
  if (revert) return revert;
  const refine = await handlePlanRefineRoute(request, url, env, ctx, identity, services);
  if (refine) return refine;
  const save = await handlePlanSaveRoute(request, url, env, ctx, identity, services);
  if (save) return save;
  const execute = await handlePlanExecuteRoute(request, url, env, ctx, identity, services);
  if (execute) return execute;
  return handlePlanTaskResumeRoute(request, url, env, ctx, identity, services);
}
