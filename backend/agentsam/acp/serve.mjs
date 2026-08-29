#!/usr/bin/env node
/**
 * agentsam acp serve — local stdio ACP agent bridging to IAM /api/acp.
 *
 * Uses @agentclientprotocol/sdk (ndJsonStream + fluent agent()) — no custom framing.
 *
 * Env:
 *   AGENTSAM_ACP_URL   — default https://inneranimalmedia.com/api/acp
 *   AGENTSAM_ACP_TOKEN — Bearer token
 *   AGENTSAM_ACP_COOKIE — Cookie header (alternative auth)
 */

import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';

const ACP_URL = (process.env.AGENTSAM_ACP_URL || 'https://inneranimalmedia.com/api/acp').replace(
  /\/$/,
  '',
);
const TOKEN = process.env.AGENTSAM_ACP_TOKEN || '';
const COOKIE = process.env.AGENTSAM_ACP_COOKIE || '';

/**
 * @param {string} method
 * @param {Record<string, unknown>} [params]
 * @param {{ stream?: boolean }} [opts]
 */
async function callRemote(method, params = {}, opts = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: opts.stream ? 'application/x-ndjson, application/json' : 'application/json',
  };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  if (COOKIE) headers.cookie = COOKIE;

  const res = await fetch(ACP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method,
      params,
    }),
  });

  const ct = res.headers.get('content-type') || '';
  if (opts.stream || ct.includes('ndjson')) {
    return { streaming: true, response: res };
  }
  const json = await res.json();
  if (json.error) {
    const err = new Error(json.error.message || 'acp_remote_error');
    throw err;
  }
  return { streaming: false, result: json.result };
}

class AgentSamAcpBridge {
  async initialize(params) {
    const remote = await callRemote('initialize', params || {});
    return (
      remote.result || {
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true },
        agentInfo: { name: 'Agent Sam', version: 'sdk-bridge' },
      }
    );
  }

  async authenticate(params) {
    await callRemote('authenticate', params || {});
    return {};
  }

  async newSession(params) {
    const remote = await callRemote('session/new', params || {});
    return { sessionId: remote.result.sessionId };
  }

  async loadSession(params) {
    const remote = await callRemote('session/load', params || {});
    return { sessionId: remote.result.sessionId };
  }

  /**
   * @param {Record<string, unknown>} params
   * @param {{ notify: (method: string, params: unknown) => Promise<void> }} client
   */
  async prompt(params, client) {
    const remote = await callRemote('session/prompt', params || {}, { stream: true });
    if (!remote.streaming) {
      return remote.result || { stopReason: 'end_turn' };
    }
    if (!remote.response.ok || !remote.response.body) {
      const t = await remote.response.text().catch(() => '');
      throw new Error(`prompt_http_${remote.response.status}:${t.slice(0, 300)}`);
    }
    const reader = remote.response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let stopReason = 'end_turn';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.method === acp.methods.client.session.update && msg.params) {
          await client.notify(acp.methods.client.session.update, msg.params);
        } else if (msg.result) {
          stopReason = msg.result.stopReason || stopReason;
        } else if (msg.error) {
          throw new Error(msg.error.message || 'prompt_failed');
        }
      }
    }
    return { stopReason };
  }

  async cancel(params) {
    await callRemote('session/cancel', params || {});
  }
}

const bridge = new AgentSamAcpBridge();
const output = Writable.toWeb(process.stdout);
const input = Readable.toWeb(process.stdin);
const stream = acp.ndJsonStream(output, input);

acp
  .agent({ name: 'agentsam' })
  .onRequest('initialize', (ctx) => bridge.initialize(ctx.params))
  .onRequest('session/new', (ctx) => bridge.newSession(ctx.params))
  .onRequest('session/load', (ctx) => bridge.loadSession(ctx.params))
  .onRequest('authenticate', (ctx) => bridge.authenticate(ctx.params))
  .onRequest('session/prompt', (ctx) => bridge.prompt(ctx.params, ctx.client))
  .onNotification('session/cancel', (ctx) => bridge.cancel(ctx.params))
  .connect(stream);
