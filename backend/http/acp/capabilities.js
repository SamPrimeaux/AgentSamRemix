/**
 * ACP agent capability advertisement + transport spike notes (Phase 0).
 *
 * Transport law (plan rev 2.1): use official @agentclientprotocol/sdk transport
 * helpers where compatible with Cloudflare. Do not invent custom JSON-RPC framing.
 *
 * Spike outcome (2026-08-20, Workers):
 * - Prefer **Streamable HTTP**: POST JSON-RPC for client→agent; for session/prompt
 *   return **NDJSON** of JSON-RPC notifications (`session/update`) then final result.
 * - Official `createHttpStream` (experimental/http-client) uses POST + SSE GET —
 *   our NDJSON prompt stream is the Worker-compatible agent-side counterpart for
 *   unary+stream turns without locking WebSocket a priori.
 * - WebSocket remains a future option after a DO-backed spike; not the default.
 */

import { ACP_PROTOCOL_VERSION } from './jsonrpc.js';

/** @returns {Record<string, unknown>} */
export function buildInitializeResult() {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: {
        image: true,
        audio: false,
        embeddedContext: true,
      },
      // Client capabilities we may request when the ACP client advertises them:
      // fs + terminal are Client methods — see client-fs-broker / client-terminal-broker.
    },
    agentInfo: {
      name: 'Agent Sam',
      title: 'Inner Animal Media — Agent Sam',
      version: 'acp-core-1',
    },
    /** Proof artifact for Phase 0 transport spike */
    _meta: {
      iam: {
        transport_spike: {
          chosen: 'streamable_http_ndjson',
          alternatives_considered: ['websocket_do', 'unary_http_only'],
          reason:
            'Workers-friendly; JSON-RPC objects only; aligns with ACP Streamable HTTP direction without custom framing',
          sdk_package: '@agentclientprotocol/sdk',
          sdk_http_helper: '@agentclientprotocol/sdk/experimental/http-client',
          locked_ws: false,
        },
        session_mapping: 'conversation_id',
        run_mapping: 'agentsam_agent_run_per_prompt',
      },
    },
  };
}

/**
 * @param {Record<string, unknown>} clientCaps
 */
export function summarizeClientCapabilities(clientCaps) {
  const caps = clientCaps && typeof clientCaps === 'object' ? clientCaps : {};
  return {
    fs: caps.fs === true || (caps.fs && typeof caps.fs === 'object'),
    terminal: caps.terminal === true || (caps.terminal && typeof caps.terminal === 'object'),
  };
}
