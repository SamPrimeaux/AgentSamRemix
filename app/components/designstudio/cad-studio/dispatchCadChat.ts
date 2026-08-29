import { IAM_AGENT_CHAT_COMPOSE } from '../../../agentChatConstants';
import {
  preferredCatalogToolsForOperator,
  type CadOperator,
} from './operators';

export type CadChatDispatchOpts = {
  operator?: CadOperator;
  operatorId?: string;
  prompt?: string;
  workspace?: string;
  selectedObjectId?: string | null;
  sceneId?: string | null;
  /** Optional Meshy ids when known from UI (agent freehands the rest). */
  meshyContext?: {
    rig_task_id?: string | null;
    model_task_id?: string | null;
    action_id?: number | null;
    action_name?: string | null;
  };
  send?: boolean;
};

/**
 * Explicit CAD Studio button id → tool-profile task_type.
 * This is NOT message-text inference — operatorId comes from a known UI control
 * the user clicked (generateObject, meshyRig, …).
 */
export function taskTypeForCadOperator(operatorId: string): string {
  const id = String(operatorId || '').trim();
  if (id === 'generateObject') return 'meshy_generate';
  if (id === 'meshyRig' || id === 'meshyAnimate') return 'meshy_animation';
  if (
    id === 'meshyRemesh' ||
    id === 'meshyConvert' ||
    id === 'meshyResize' ||
    id === 'meshyUvUnwrap' ||
    id === 'meshyRetexture'
  ) {
    return 'meshy_transform';
  }
  return 'cad_generation';
}

/**
 * Compose an intent message for ChatAssistant.
 * Operators set *intent* + preferred catalog tool keys (D1-pinned).
 * The model freehands tool arguments against agentsam_tools.input_schema —
 * this is not hardcoded FreeCAD/Blender/OpenSCAD script injection.
 *
 * task_type / route_key are set from the explicit button id only — never from
 * free-text message matching.
 */
export function dispatchCadChat(opts: CadChatDispatchOpts): void {
  const {
    operator,
    operatorId,
    prompt,
    workspace,
    selectedObjectId,
    sceneId,
    meshyContext,
    send = false,
  } = opts;

  const opId = operator?.id ?? operatorId ?? 'unknown';
  const opTitle = operator?.title ?? opId;
  const engine = operator?.engine ?? 'Runner';
  const tools = preferredCatalogToolsForOperator(opId);
  const taskType = taskTypeForCadOperator(opId);

  const lines = [
    `[IAM CAD Studio] Run operator: **${opTitle}** (\`${opId}\`)`,
    `- Engine: ${engine}`,
    workspace ? `- Workspace: ${workspace}` : null,
    selectedObjectId ? `- Selected object: \`${selectedObjectId}\`` : null,
    sceneId ? `- Scene: \`${sceneId}\`` : null,
    tools.length
      ? `- Preferred catalog tools (call these — freehand args from schemas): ${tools.map((t) => `\`${t}\``).join(', ')}`
      : null,
    meshyContext?.model_task_id
      ? `- Meshy model_task_id: \`${meshyContext.model_task_id}\``
      : null,
    meshyContext?.rig_task_id ? `- Meshy rig_task_id: \`${meshyContext.rig_task_id}\`` : null,
    meshyContext?.action_id != null
      ? `- Meshy action_id: ${meshyContext.action_id}${
          meshyContext.action_name ? ` (${meshyContext.action_name})` : ''
        }`
      : null,
    prompt?.trim() ? `\nIntent:\n${prompt.trim()}` : null,
    opId === 'meshyAnimate' ||
    opId === 'meshyRig' ||
    opId === 'meshyRemesh' ||
    opId === 'meshyConvert' ||
    opId === 'meshyResize' ||
    opId === 'meshyUvUnwrap' ||
    opId === 'meshyRetexture'
      ? '\nUse only the canonical Meshy tools in this bounded profile. Poll meshy_get_task_status and use the returned public artifact when ready.'
      : '\nUse cad_generate for engine-neutral OpenSCAD, FreeCAD, or Blender intake. Update the Design Studio viewport when artifacts are ready.',
  ].filter(Boolean);

  window.dispatchEvent(
    new CustomEvent(IAM_AGENT_CHAT_COMPOSE, {
      detail: {
        message: lines.join('\n'),
        send,
        ensureAgentPanel: true,
        task_type: taskType,
        route_key: 'design_studio',
      },
    }),
  );
}

export function dispatchGenerateCadObject(body: {
  prompt: string;
  engine?: string;
  target?: string;
  units?: string;
  quality?: string;
  workspace?: string;
  sceneId?: string | null;
}): void {
  const engine = body.engine ?? 'Meshy';
  const isMeshy = /meshy/i.test(engine);
  const lines = [
    '[IAM CAD Studio] **Generate CAD Object**',
    `- Engine: ${engine}`,
    body.target ? `- Target: ${body.target}` : null,
    body.units ? `- Units: ${body.units}` : null,
    body.quality ? `- Quality: ${body.quality}` : null,
    body.workspace ? `- Workspace: ${body.workspace}` : null,
    body.sceneId ? `- Scene: \`${body.sceneId}\`` : null,
    isMeshy
      ? '- Preferred catalog tools: `meshy_text_to_3d`, `meshy_get_task_status`'
      : '- Preferred catalog tools: `cad_generate`, `cad_job_status`',
    `\nDescription:\n${body.prompt.trim()}`,
    '\nCall catalog tools with freehand args. Spawn the GLB in the Design Studio viewport when complete. Do not fake progress with imgx_generate_image.',
  ].filter(Boolean);

  window.dispatchEvent(
    new CustomEvent(IAM_AGENT_CHAT_COMPOSE, {
      detail: {
        message: lines.join('\n'),
        send: true,
        ensureAgentPanel: true,
        task_type: isMeshy ? 'meshy_generate' : 'cad_generation',
        route_key: 'design_studio',
      },
    }),
  );
}
