/**
 * Chat sessions peel manifest — migration tracker (src/core → backend/agentsam/sessions).
 * **Not** exported from index.js — delete this file when the peel completes.
 *
 * Law: no src/ re-export bridges. Status `live` means legacy path is deleted.
 *
 * @module backend/agentsam/sessions/peel-manifest
 */

/** @typedef {'live'|'peel_target'|'in_progress'|'deleted'} PeelStatus */

/**
 * @type {readonly { id: string, status: PeelStatus, canonical: string, legacy: string, notes?: string }[]}
 */
export const SESSIONS_PEEL_MANIFEST = Object.freeze([
  { id: 'metadata_repository', status: 'live', canonical: 'backend/agentsam/sessions/metadata-repository.js', legacy: 'src/core/agentsam-chat-sessions.js (deleted)' },
  { id: 'title_derivation', status: 'live', canonical: 'backend/agentsam/sessions/title.js', legacy: 'deleted S1' },
  { id: 'project_bind', status: 'live', canonical: 'backend/agentsam/sessions/project-bind.js', legacy: 'src/core/project-chat-link.js session half (deleted)' },
  { id: 'project_context', status: 'live', canonical: 'backend/agentsam/runtime/project-context.js', legacy: 'src/core/project-chat-link.js context half (deleted)' },
  { id: 'do_handlers', status: 'live', canonical: 'backend/agentsam/sessions/do/*', legacy: 'src/core/agent-session/* (deleted S2)' },
  { id: 'chat_do_client', status: 'live', canonical: 'backend/agentsam/sessions/chat-do-client.js', legacy: 'src/core/chat-session-do-messages.js + do-access (deleted S3)' },
  { id: 'session_context', status: 'live', canonical: 'backend/agentsam/sessions/session-context.js', legacy: 'src/core/agent-session-context.js (deleted S3)' },
  { id: 'turn_outbox_client', status: 'live', canonical: 'backend/agentsam/sessions/turn-outbox-client.js', legacy: 'src/core/chat-turn-outbox.js (deleted S3)' },
  { id: 'r2_archive', status: 'live', canonical: 'backend/agentsam/sessions/compaction/archive.js', legacy: 'src/core/chat-session-r2.js (deleted S3)' },
  { id: 'session_purge', status: 'live', canonical: 'backend/agentsam/sessions/purge.js', legacy: 'src/core/chat-session-purge.js (deleted S3)' },
  { id: 'artifact_count', status: 'live', canonical: 'backend/agentsam/sessions/artifact-count.js', legacy: 'src/core/chat-session-artifact-count.js (deleted S3)' },
  { id: 'window_assemble', status: 'live', canonical: 'backend/agentsam/sessions/window/assemble.js', legacy: 'src/core/turn-context-assembler.js (deleted S4)' },
  { id: 'window_hydrate', status: 'live', canonical: 'backend/agentsam/sessions/window/hydrate.js', legacy: 'src/core/chat-hydrate-window.js (deleted S4)' },
  { id: 'compaction', status: 'live', canonical: 'backend/agentsam/sessions/compaction/compact.js', legacy: 'src/core/conversation-compaction.js (deleted S4)' },
  { id: 'thread_on_demand', status: 'live', canonical: 'backend/agentsam/sessions/thread-on-demand.js', legacy: 'src/core/thread-on-demand.js (deleted)' },
  { id: 'mode_controllers', status: 'live', canonical: 'backend/agentsam/runtime/modes/*', legacy: 'src/core/mode-controllers/* (deleted R5)' },
  { id: 'http_chat_sessions', status: 'live', canonical: 'backend/http/agentsam/chat-sessions.js', legacy: 'src/api/agent/chat/sessions.js (deleted S6)' },
  { id: 'http_chat_turn', status: 'live', canonical: 'backend/http/agentsam/chat-turn.js', legacy: 'src/api/agent/chat/turn.js (deleted S6)' },
  { id: 'http_chat_fsa', status: 'live', canonical: 'backend/http/agentsam/chat-fsa-fulfill.js', legacy: 'src/api/agent/chat/fsa-fulfill.js (deleted S6)' },
  { id: 'http_chat_approved', status: 'live', canonical: 'backend/http/agentsam/chat-approved-tool.js', legacy: 'src/api/agent/chat/approved-tool.js (deleted S6)' },
  {
    id: 'turn_context',
    status: 'live',
    canonical: 'backend/agentsam/runtime/turn/context.js',
    legacy: 'src/core/agent-chat/turn-context.js (deleted)',
    notes: 'Domain resolve returns structured error; HTTP chat-turn maps to jsonResponse',
  },
  {
    id: 'agent_chat_do_shell',
    status: 'live',
    canonical: 'src/do/AgentChat.js',
    legacy: 'imports backend/agentsam/sessions/do/*',
  },
]);

/** @param {string} id */
export function peelEntry(id) {
  return SESSIONS_PEEL_MANIFEST.find((e) => e.id === id) ?? null;
}

/** Rows not yet live in backend — legacy must not be deleted until in_progress → live */
export function pendingPeelTargets() {
  return SESSIONS_PEEL_MANIFEST.filter((e) => e.status === 'peel_target' || e.status === 'in_progress');
}
