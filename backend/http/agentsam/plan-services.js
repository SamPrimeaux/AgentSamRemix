/**
 * Compose the Plan service bundle at the Worker boundary.
 *
 * Backend runtime code owns the bundle shape and all backend implementations.
 * The Worker composition caller supplies legacy adapters until their individual
 * source peels land; backend code never imports those adapters directly.
 */
import { insertApprovalQueueRow } from '../../agentsam/approvals/queue.js';
import { createPlanExecutor } from '../../agentsam/runtime/plan/executor.js';
import * as plannerModule from '../../services/planning/planner.js';
import * as refineModule from '../../services/planning/refine.js';
import * as workflow from '../../workflows/integrations/agent-plan.js';
import { createQuickstartIntakeResume } from './quickstart-resume.js';
import { startPlanRefineSseResponse } from './plan-refine-stream.js';

async function loadExecutionStepColumns(db) {
  if (!db) return new Set();
  const schema = await db
    .prepare('PRAGMA table_info(agentsam_execution_steps)')
    .all()
    .catch(() => ({ results: [] }));
  return new Set(
    (schema?.results || [])
      .map((column) => String(column?.name || '').trim().toLowerCase())
      .filter(Boolean),
  );
}

const REQUIRED_CHAT_SERVICES = [
  'startAgentChatEarlySse',
  'withD1Retry',
  'loadAgentSamUserPolicy',
  'evaluateGuardrails',
  'resolveSubagentProfileForChat',
  'applySubagentDefaultModelToBody',
  'kickoffModelTierMigration',
  'parseJsonSafe',
  'parseStagedAttachmentIds',
  'peekAgentAttachment',
  'assertTenantSpendPolicy',
  'executeAgentChatSpine',
];
/**
 * @param {Record<string, any>} modules
 */
export function composePlanServices(modules = {}) {
  const {
    intake,
    save,
    artifacts,
    planInsert,
    executionJournal,
    localPath,
    provider,
    dispatch,
    model,
    canonicalUser,
    auth,
    modelResolver,
    roadblocks,
    browser,
    excalidraw,
    github,
    fsEdit,
    fsWrite,
    gcpCwd,
    workspacePaths,
    skill,
    cms,
  } = modules;

  const planner = plannerModule.createPlanService({
    dispatchComplete: provider?.dispatchComplete,
    resolveModelForTask: model?.resolveModelForTask,
    resolveCanonicalUserId: canonicalUser?.resolveCanonicalUserId,
    pragmaTableInfo,
    createPlanExcalidrawArtifact: artifacts?.createPlanExcalidrawArtifact,
    createPlanMarkdownArtifact: artifacts?.createPlanMarkdownArtifact,
    insertAgentsamPlanRow: planInsert?.insertAgentsamPlanRow,
    compactExecutionStepJson: executionJournal?.compactExecutionStepJson,
    insertApprovalQueueRow,
  });
  const refine = refineModule.createPlanRefiner({
    dispatchComplete: provider?.dispatchComplete,
    resolveModelForTask: model?.resolveModelForTask,
    pragmaTableInfo,
    createPlanMarkdownArtifact: artifacts?.createPlanMarkdownArtifact,
    normalizePlannerTask: plannerModule.normalizePlannerTask,
  });

  return {
    intake,
    planner: { ...plannerModule, ...planner },
    workflow,
    planLocalRelPath: localPath?.planLocalRelPath,
    hydrateSkillRowFromR2: skill?.hydrateSkillRowFromR2,
    linkCmsProjectPlan: cms?.linkCmsProjectPlan,
    startPlanRefineSseResponse,
    refineAgentsamPlan: refine.refineAgentsamPlan,
    revertAgentsamPlan: refine.revertAgentsamPlan,
    savePlanToWorkspaceArtifacts: save?.savePlanToWorkspaceArtifacts,
    executePlan: createPlanExecutor({
      dispatchComplete: provider?.dispatchComplete,
      dispatchByToolCode: dispatch?.dispatchByToolCode,
      resolveModelForTask: model?.resolveModelForTask,
      resolveCanonicalUserId: canonicalUser?.resolveCanonicalUserId,
      fetchAuthUserTenantId: auth?.fetchAuthUserTenantId,
      pragmaTableInfo,
      insertPlanExecutionStep: planner.insertPlanExecutionStep,
      resolvePlanTaskCapabilityType: plannerModule.resolvePlanTaskCapabilityType,
      recordArmOutcome: modelResolver?.recordArmOutcome,
      emitPlanRoadblockQuestions: roadblocks?.emitPlanRoadblockQuestions,
      runBrowserCapabilityAction: browser?.runBrowserCapabilityAction,
      runExcalidrawCapabilityAction: excalidraw?.runExcalidrawCapabilityAction,
      githubHandlers: github?.handlers,
      executeFsEditFile: fsEdit?.executeFsEditFile,
      executeFsWriteFile: fsWrite?.executeFsWriteFile,
      resolveIdentityScopedGcpCwd: gcpCwd?.resolveIdentityScopedGcpCwd,
      loadWorkspaceSettingsJson: workspacePaths?.loadWorkspaceSettingsJson,
    }).executePlan,
  };
}

/**
 * Normalize the independently owned chat adapters into the stable runtime
 * contract. The composer deliberately throws for missing required functions;
 * a partial bundle would otherwise fail after opening an SSE stream.
 *
 * @param {Record<string, any>} modules
 */
export function composeChatServices(modules = {}) {
  const chat = {
    ...modules.adapters,
    ...(modules.chatServices || {}),
  };

  for (const key of REQUIRED_CHAT_SERVICES) {
    if (typeof modules[key] === 'function') chat[key] = modules[key];
    if (typeof chat[key] !== 'function') {
      throw new TypeError(`agent_chat_service_required:${key}`);
    }
  }

  chat.resumeQuickstartIntakeTurn =
    typeof chat.resumeQuickstartIntakeTurn === 'function'
      ? chat.resumeQuickstartIntakeTurn
      : createQuickstartIntakeResume({
          services: chat,
          planServices: modules.planServices || null,
          buildEnrichedGoalFromIntakeBatch: modules.buildEnrichedGoalFromIntakeBatch,
        });
  if (typeof chat.resumeQuickstartIntakeTurn !== 'function') {
    throw new TypeError('agent_chat_service_required:resumeQuickstartIntakeTurn');
  }
  return chat;
}
