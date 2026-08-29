import type { ArtifactRecord } from '../client-api/artifacts';
import {
  IAM_AGENT_CHAT_COMPOSE,
  IAM_AGENT_CHAT_CONVERSATION_CHANGE,
  IAM_ARTIFACT_OPEN_BUILDER,
  type ArtifactOpenBuilderDetail,
} from '../agentChatConstants';
import type { ArtifactCategory } from '../config/artifactCategories';

const CODE_TYPES = new Set(['html', 'jsx', 'tsx', 'javascript', 'typescript', 'sql', 'json', 'css']);

export function isCodeArtifact(artifact: ArtifactRecord): boolean {
  const t = String(artifact.artifact_type || '').toLowerCase();
  if (CODE_TYPES.has(t)) return true;
  return /html|jsx|tsx|javascript|typescript|sql|component|migration/.test(t);
}

function dispatchCompose(message: string, send = true) {
  window.dispatchEvent(
    new CustomEvent(IAM_AGENT_CHAT_COMPOSE, {
      detail: { message, send, ensureAgentPanel: true },
    }),
  );
}

function dispatchBuilder(tab: ArtifactOpenBuilderDetail['tab'] = 'code') {
  window.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent(IAM_ARTIFACT_OPEN_BUILDER, {
        detail: { tab },
      }),
    );
  }, 140);
}

export function startArtifactFromCategory(category: ArtifactCategory) {
  dispatchCompose(category.seedPrompt, true);
  if (category.openBuilder) dispatchBuilder(category.builderTab);
}

export function continueArtifactInChat(artifact: ArtifactRecord) {
  const sessionId = artifact.source_session_id?.trim();
  if (sessionId) {
    window.dispatchEvent(new CustomEvent(IAM_AGENT_CHAT_CONVERSATION_CHANGE, { detail: { id: sessionId } }));
  }
  const msg = sessionId
    ? `Continue working on artifact "${artifact.name}".`
    : `Help me refine artifact "${artifact.name}" (${artifact.artifact_type}). R2: ${artifact.r2_key}`;
  dispatchCompose(msg, true);
}

export function openArtifactInBuilder(artifact: ArtifactRecord) {
  const msg = `Open artifact "${artifact.name}" in the code workbench. Type: ${artifact.artifact_type}. R2 key: ${artifact.r2_key}`;
  dispatchCompose(msg, true);
  dispatchBuilder('code');
}
