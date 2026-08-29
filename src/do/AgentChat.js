/**
 * High-performance Agent Chat storage using the native Worker SQL API.
 * Durable Object lifecycle/orchestration; capability logic lives under core/agent-session and core/terminal-session.
 */
import { DurableObject } from "cloudflare:workers";
import { handleTerminalWebSocket as openTerminalWebSocket, sendStateToWebSocket as sendTerminalState, broadcastState as broadcastTerminalState, broadcastTerminalOutput as broadcastOutput, getSocketMeta as getTerminalSocketMeta, webSocketMessage as handleTerminalSocketMessage, webSocketClose as handleTerminalSocketClose, webSocketError as handleTerminalSocketError } from "../../backend/agentsam/terminal/websocket.js";
import { connectPty as connectTerminalPty, persistPtySessionContext as persistPtyContext, restorePtySessionContext as restorePtyContext, ensurePtyConnected as ensurePtySessionConnected } from "../../backend/agentsam/terminal/pty-connection.js";
import { _ptyExecPayload as buildPtyExecPayload, executePtyCommand as runPtyCommand, _executePtyCommandOnce as runPtyCommandOnce } from "../../backend/agentsam/terminal/pty-exec.js";
import { handleTerminalExec as runTerminalExecRequest, getTerminalStatus as readTerminalStatus, ensureModeReady as ensureTerminalModeReady } from "../../backend/agentsam/terminal/session-state.js";
import { upsertTerminalSessionRow as persistTerminalSessionRow, getOrCreateTerminalSessionId as ensureTerminalSessionId } from "../../backend/agentsam/terminal/session-store.js";
import { resolveSshTarget as resolveTerminalSshTarget, executeSshCommand as runSshCommand, parseMcpInvocation as parseTerminalMcpInvocation, executeMcpCommand as runMcpCommand } from "../../backend/agentsam/terminal/alternate-exec.js";
import { closeTerminalSessionInD1 as closeTerminalSession, insertTerminalHistoryRow as insertHistoryRow, recordExecTerminalHistory as recordExecHistory, recordPtyOutputChunk as bufferPtyOutput, flushPtyOutputBuffer as flushPtyOutput, maybeFinalizeTerminalSession as finalizeTerminalSession } from "../../backend/agentsam/terminal/history.js";
import { initializeAgentSessionSchema, migrateSessionMessagesSchema as migrateMessagesSchema, migrateTurnOutboxSchema as migrateOutboxSchema, migrateSessionAgentContextSchema as migrateContextSchema } from "../../backend/agentsam/sessions/do/schema.js";
import { setSessionContext as setAgentSessionContext, getSessionContext as getAgentSessionContext } from "../../backend/agentsam/sessions/do/context.js";
import { handlePostMessage as postSessionMessage, handlePatchMessage as patchSessionMessage, handleGetHistory as getSessionHistory } from "../../backend/agentsam/sessions/do/messages.js";
import { handlePostOutbox as postTurnOutbox, handleGetOutbox as getTurnOutbox, handleTurnOutboxStream as streamTurnOutbox, pruneTurnOutbox } from "../../backend/agentsam/sessions/do/turn-outbox.js";
import { waitForFsaFulfill as waitForFsaResult, fulfillFsaRequest as fulfillFsaResult, cancelPendingFsaRequests as cancelPendingFsa } from "../../backend/agentsam/sessions/do/fsa-fulfill.js";
import { bootstrapAgentChatTurn } from "../../backend/agentsam/sessions/do/bootstrap.js";
import { appendDesignStudioEvent, handleDesignStudioEventStream as streamDesignStudioEvents } from "../../backend/agentsam/sessions/do/designstudio-events.js";
import { loadWorkspaceSettings as loadAgentWorkspaceSettings, ensureWorkspaceSettingsLoaded as ensureAgentWorkspaceSettings } from "../../backend/agentsam/sessions/do/workspace-settings.js";
import { resolveTerminalCwd } from "../../backend/agentsam/terminal/pty-workspace-paths.js";
import { pingTunnelHealth } from "../../backend/http/agentsam/routes/git-status-runtime.js";
import { initializeTerminalJobsSchema, recoverInterruptedTerminalJobs } from "../core/terminal-jobs/schema.js";
import { handleTerminalJobsApi } from "../core/terminal-jobs/api.js";
import { reconcileTerminalJobOrchestration } from "../core/terminal-jobs/orchestration.js";

const TERMINAL_WS_TAG = "terminal";
const TUNNEL_HEALTH_ALARM_INTERVAL_MS = 300_000;

export class AgentChatSqlV1 extends DurableObject {
  /**
   * @param {import('@cloudflare/workers-types').DurableObjectState} state
   * @param {Record<string, unknown>} env
   */
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.env = env;
    /** @type {import('@cloudflare/workers-types').SqlStorage} */
    this.sql = state.storage.sql;
    state.blockConcurrencyWhile(async () => {
      // Compose session + terminal schemas at the DO shell — sessions/do must not own terminal.
      initializeAgentSessionSchema(this.sql);
      initializeTerminalJobsSchema(this.sql);
      recoverInterruptedTerminalJobs(this.sql);
      await reconcileTerminalJobOrchestration(this);
    });

    this.ptyWs = null;
    this.ptyConnectPromise = null;
    this.cachedTerminalSessionId = null;
    this.terminalLineBuffers = new Map();
    /** Set only from explicit request context; never inferred from Worker environment state. */
    this.workspaceId = "";
    this.workspaceSettings = {};
    this.workspaceSettingsPromise = null;
    /** Auth user id from /terminal/ws or /terminal/exec (for upstream PTY tenant isolation). */
    this.ptSessionUserId = "";
    this.ptSessionTenantId = "";
    this.ptPersonUuid = "";
    /** PTY cwd — workspace_settings.workspace_root (local) or ExecOS home (GCP remote) */
    this.ptyWorkingDir = null;
    this.historySequence = 0;
    this._ptyOutBuf = "";
    this._ptyOutFlushTimer = null;
    /** @type {string | null} PTY shell from browser query (?shell=); applied on connectPty. */
    this.terminalShellOverride = null;
    /** Target routing from /terminal/ws query params — default platform_vm (dock VM). */
    this.requestedTargetType = "platform_vm";
    this.requestedConnectionId = "";
    this.requestedToolName = "";
    /** Selected terminal_connections row for current session. */
    this.selectedTerminalConnection = null;
    this.selectedTargetType = "platform_vm";
  }

  migrateSessionMessagesSchema() {
    return migrateMessagesSchema(this.sql);
  }

  migrateTurnOutboxSchema() {
    return migrateOutboxSchema(this.sql);
  }

  migrateSessionAgentContextSchema() {
    return migrateContextSchema(this.sql);
  }

  /**
   * @param {unknown} tools
   * @param {unknown} writePolicy
   * @param {unknown} roots
   */
  async setSessionContext(tools, writePolicy, roots) {
    return setAgentSessionContext(this, tools, writePolicy, roots);
  }

  async getSessionContext() {
    return getAgentSessionContext(this);
  }

  /**
   * Durable Code Mode host — createCodemodeRuntime needs this DO's facets + SQLite.
   * @param {Record<string, unknown>} [runContext]
   * @param {{ tools?: Array<Record<string, unknown>> }} [opts]
   */
  async prepareCodemodeRuntime(runContext = {}, opts = {}) {
    const built = await this.#ensureCodemodeBuilt(runContext, opts);
    const connectorName = String(built.connectorName || '').trim();
    if (!connectorName) {
      throw new Error('prepareCodemodeRuntime: buildCodemodeToolset omitted connectorName');
    }
    return {
      toolCount: built.toolCount,
      connectorName,
      description: built.codemodeTool?.description != null
        ? String(built.codemodeTool.description)
        : '',
      mode: 'durable_runtime',
    };
  }

  /**
   * @param {{ code?: string }} input
   * @param {Record<string, unknown>} [runContext]
   * @param {{ tools?: Array<Record<string, unknown>> }} [opts]
   */
  async executeCodemode(input, runContext = {}, opts = {}) {
    const built = await this.#ensureCodemodeBuilt(runContext, opts);
    return built.runtime.execute({ code: String(input?.code || '') });
  }

  /**
   * @param {{ executionId?: string }} options
   * @param {Record<string, unknown>} [runContext]
   * @param {{ tools?: Array<Record<string, unknown>> }} [opts]
   */
  async approveCodemode(options, runContext = {}, opts = {}) {
    const built = await this.#ensureCodemodeBuilt(runContext, opts);
    return built.runtime.approve({ executionId: String(options?.executionId || '') });
  }

  /**
   * @param {{ executionId?: string, seq?: number }} options
   * @param {Record<string, unknown>} [runContext]
   * @param {{ tools?: Array<Record<string, unknown>> }} [opts]
   */
  async rejectCodemode(options, runContext = {}, opts = {}) {
    const built = await this.#ensureCodemodeBuilt(runContext, opts);
    return built.runtime.reject({
      executionId: String(options?.executionId || ''),
      seq: Number(options?.seq),
    });
  }

  /**
   * @param {string|undefined} executionId
   * @param {Record<string, unknown>} [runContext]
   * @param {{ tools?: Array<Record<string, unknown>> }} [opts]
   */
  async pendingCodemode(executionId, runContext = {}, opts = {}) {
    const built = await this.#ensureCodemodeBuilt(runContext, opts);
    return built.runtime.pending(executionId != null ? String(executionId) : undefined);
  }

  /**
   * Merge per-turn Files-rail / identity into the bag catalog tools read at execute time.
   * @param {Record<string, unknown>} runContext
   */
  #mergeCodemodeDispatchContext(runContext = {}) {
    if (!this._codemodeDispatchContext || typeof this._codemodeDispatchContext !== 'object') {
      this._codemodeDispatchContext = Object.create(null);
    }
    Object.assign(this._codemodeDispatchContext, runContext || {});
  }

  /**
   * @param {Record<string, unknown>} runContext
   * @param {{ tools?: Array<Record<string, unknown>> }} opts
   */
  async #ensureCodemodeBuilt(runContext = {}, opts = {}) {
    this.#mergeCodemodeDispatchContext(runContext);
    const toolNames = Array.isArray(opts.tools)
      ? opts.tools.map((x) => String(x?.name || x?.tool_name || '').trim()).filter(Boolean).sort()
      : [];
    const cacheKey = JSON.stringify({
      ws: String(runContext.workspaceId ?? runContext.workspace_id ?? ''),
      tenant: String(runContext.tenantId ?? runContext.tenant_id ?? ''),
      user: String(runContext.userId ?? runContext.user_id ?? ''),
      execLane: String(runContext.exec_lane ?? runContext.execLane ?? '').trim().toLowerCase() || null,
      tools: toolNames,
    });
    if (this._codemodeBuilt && this._codemodeBuiltKey === cacheKey) {
      return this._codemodeBuilt;
    }
    const { buildCodemodeToolset } = await import('../core/codemode-tool-set.js');
    const built = await buildCodemodeToolset(this.env, this._codemodeDispatchContext, {
      tools: opts.tools,
      durableCtx: this.ctx,
      getRunContext: () => this._codemodeDispatchContext,
    });
    this._codemodeBuilt = built;
    this._codemodeBuiltKey = cacheKey;
    return built;
  }

  /**
   * Park until client POSTs fulfill (awaits so other DO requests can interleave).
   * @param {string} callId
   * @param {{ timeoutMs?: number }} [opts]
   */
  async waitForFsaFulfill(callId, opts = {}) {
    return waitForFsaResult(this, callId, opts);
  }

  /**
   * @param {string} callId
   * @param {unknown} result
   */
  async fulfillFsaRequest(callId, result) {
    return fulfillFsaResult(this, callId, result);
  }

  /**
   * Reject parked FSA waiters for this conversation (SSE/stream cancel).
   * @param {string} [reason]
   */
  async cancelPendingFsaRequests(reason = 'stream_canceled') {
    return cancelPendingFsa(this, reason);
  }

  /**
   * History + session context + optional codemode in one RPC.
   * @param {Record<string, unknown>} [opts]
   */
  async bootstrapTurn(opts = {}) {
    await this.scheduleTunnelHealthAlarm();
    return bootstrapAgentChatTurn(this, opts);
  }

  /** @param {Request} request */
  async handlePostOutbox(request) {
    return postTurnOutbox(this, request);
  }

  /** @param {URL} url */
  async handleGetOutbox(url) {
    return getTurnOutbox(this, url);
  }

  /** @param {URL} url */
  handleTurnOutboxStream(url) {
    return streamTurnOutbox(this, url);
  }

  /** @param {Request} request */
  async handlePostMessage(request) {
    return postSessionMessage(this, request);
  }

  /**
   * @param {string} id
   * @param {Request} request
   */
  async handlePatchMessage(id, request) {
    return patchSessionMessage(this, id, request);
  }

  /** @param {URL} url */
  async handleGetHistory(url) {
    return getSessionHistory(this, url);
  }

  async resolvePtyTenantForSession(userId) {
    const param = String(this.ptSessionTenantId || "").trim();
    if (param) return param;
    return await resolvePtyTenantIdForUser(this.env, null, userId || this.ptSessionUserId);
  }
  async selectTerminalConnection(opts = {}) { return (await import('../../backend/agentsam/terminal/connections.js')).getSelectedTerminalConnection(this.env?.DB, opts); }
  async applyPtyWorkingDir(tenantId, userId, connection = null) {
    const cwdResult = await resolveTerminalCwd(this.env, {
      connection: connection || this.selectedTerminalConnection,
      tenantId,
      userId,
      workspaceId: this.workspaceId,
    });
    this.ptyWorkingDir = cwdResult.cwd;
    return cwdResult.cwd;
  }

  closeTerminalSessionInD1() { return closeTerminalSession(this); }

  async insertTerminalHistoryRow(direction, content, opts = {}) { return insertHistoryRow(this, direction, content, opts); }

  async recordExecTerminalHistory(command, outputText, exitCode) { return recordExecHistory(this, command, outputText, exitCode); }

  recordPtyOutputChunk(text) { return bufferPtyOutput(this, text); }

  flushPtyOutputBuffer() { return flushPtyOutput(this); }

  maybeFinalizeTerminalSession(reason) { return finalizeTerminalSession(this, reason); }

  async loadWorkspaceSettings() {
    return loadAgentWorkspaceSettings(this);
  }

  /** @param {string|null|undefined} workspaceId */
  async ensureWorkspaceSettingsLoaded(workspaceId) {
    return ensureAgentWorkspaceSettings(this, workspaceId);
  }

  /** @param {Request} request */
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/terminal/ws") {
      return this.handleTerminalWebSocket(request, url);
    }

    if (url.pathname === "/terminal/status") {
      const status = await this.getTerminalStatus(url);
      const httpStatus = status?.ok === false ? 400 : 200;
      return Response.json(status, { status: httpStatus });
    }

    if (url.pathname === "/terminal/exec" && request.method === "POST") {
      return this.handleTerminalExec(request, url);
    }

    if (url.pathname === '/terminal/jobs' || url.pathname.startsWith('/terminal/jobs/')) {
      const jobsResponse = await handleTerminalJobsApi(this, request, url);
      if (jobsResponse) return jobsResponse;
    }

    if (url.pathname === '/health') {
      return Response.json({ ok: true, class: 'AgentChatSqlV1' });
    }

    if (url.pathname === "/message" && request.method === "POST") {
      return this.handlePostMessage(request);
    }

    if (url.pathname.startsWith("/message/") && request.method === "PATCH") {
      const messageId = url.pathname.split("/")[2] || "";
      return this.handlePatchMessage(messageId, request);
    }

    if (url.pathname === "/history" && request.method === "GET") {
      return this.handleGetHistory(url);
    }

    if (url.pathname === "/bootstrap" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const out = await this.bootstrapTurn(body && typeof body === 'object' ? body : {});
      return Response.json(out);
    }

    if (url.pathname === "/wipe" && request.method === "POST") {
      try {
        this.sql.exec('DELETE FROM turn_outbox');
        this.sql.exec('DELETE FROM session_messages');
        this.sql.exec('DELETE FROM session_rag_cache');
      } catch (e) {
        return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
      }
      return Response.json({ ok: true, wiped: true });
    }

    if (url.pathname === "/outbox" && request.method === "POST") {
      return this.handlePostOutbox(request);
    }

    if (url.pathname === "/outbox/stream" && request.method === "GET") {
      return this.handleTurnOutboxStream(url);
    }

    if (url.pathname === "/outbox" && request.method === "GET") {
      return this.handleGetOutbox(url);
    }

    if (url.pathname === '/rag-cache' && request.method === 'GET') {
      const hash = url.searchParams.get('hash');
      if (!hash) return Response.json({ hit: false });
      const cutoff = Math.floor(Date.now() / 1000) - 3600;
      const rows = [...this.sql.exec(
        'SELECT query_hash, chunk_ids, context, top_score, cached_at FROM session_rag_cache WHERE query_hash = ? AND cached_at > ?',
        hash,
        cutoff,
      )];
      if (!rows.length) return Response.json({ hit: false });
      const row = rows[0];
      return Response.json({
        hit: true,
        query_hash: row.query_hash,
        chunk_ids: row.chunk_ids,
        context: row.context,
        top_score: row.top_score,
        cached_at: row.cached_at,
      });
    }

    if (url.pathname === '/rag-cache' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { query_hash, chunk_ids, context, top_score } = body;
      this.sql.exec(
        'INSERT OR REPLACE INTO session_rag_cache (query_hash, chunk_ids, context, top_score) VALUES (?,?,?,?)',
        query_hash,
        chunk_ids,
        context,
        top_score ?? 0,
      );
      return Response.json({ ok: true });
    }

    if (url.pathname === '/designstudio/stream-event' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const out = appendDesignStudioEvent(this, body?.envelope);
      return Response.json(out, { status: out.ok ? 200 : 400 });
    }

    if (url.pathname === '/designstudio/events' && request.method === 'GET') {
      return this.handleDesignStudioEventStream(url);
    }

    if (url.pathname === '/session-context' && request.method === 'GET') {
      const ctx = await this.getSessionContext();
      if (!ctx) return Response.json({ empty: true });
      return Response.json(ctx);
    }

    if (url.pathname === '/session-context' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const out = await this.setSessionContext(body.tools, body.writePolicy, {
        ...(body.roots && typeof body.roots === 'object' ? body.roots : {}),
        mode: body.mode ?? body.roots?.mode,
      });
      return Response.json(out);
    }

    if (url.pathname === '/fsa/wait' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      try {
        const result = await this.waitForFsaFulfill(body.callId, {
          timeoutMs: body.timeoutMs,
          signal: request.signal,
        });
        return Response.json(result);
      } catch (e) {
        return Response.json(
          { error: String(e?.message || e || 'fsa_wait_failed') },
          { status: 408 },
        );
      }
    }

    if (url.pathname === '/fsa/fulfill' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const out = await this.fulfillFsaRequest(body.callId, body.result);
      return Response.json(out, { status: out.ok ? 200 : 400 });
    }

    if (url.pathname === '/fsa/cancel' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const out = await this.cancelPendingFsaRequests(body?.reason || 'stream_canceled');
      return Response.json({ ok: true, ...out });
    }

    return new Response('AgentChatSqlV1 DO', { status: 200 });
  }

  /**
   * SSE fan-out from DO SQLite outbox (live stream). Filter by workflow run id inside envelope JSON.
   * @param {URL} url
   */
  handleDesignStudioEventStream(url) {
    return streamDesignStudioEvents(this, url);
  }

  async handleTerminalWebSocket(request, url) { return openTerminalWebSocket(this, request, url); }

  async handleTerminalExec(request, url) { return runTerminalExecRequest(this, request, url); }

  async getTerminalStatus(url) { return readTerminalStatus(this, url); }

  async upsertTerminalSessionRow(sessionId, opts) { return persistTerminalSessionRow(this, sessionId, opts); }

  async getOrCreateTerminalSessionId() { return ensureTerminalSessionId(this); }

  sendStateToWebSocket(ws, status, error = null, meta = null) {
    return sendTerminalState(this, ws, status, error, meta);
  }

  broadcastState(status, error = null, meta = null) {
    return broadcastTerminalState(this, status, error, meta);
  }

  broadcastTerminalOutput(text) { return broadcastOutput(this, text); }

  getSocketMeta(ws) { return getTerminalSocketMeta(this, ws); }

  async ensureModeReady(mode, opts = {}) { return ensureTerminalModeReady(this, mode, opts); }

  /**
   * Persist PTY routing context across Durable Object hibernation.
   * In-memory fields are cleared on wake; without this, keystrokes hit connectPty with empty workspace_id.
   */
  async persistPtySessionContext() { return persistPtyContext(this); }

  async restorePtySessionContext() { return restorePtyContext(this); }

  async ensurePtyConnected(opts = {}) { return ensurePtySessionConnected(this, opts); }

  async connectPty() { return connectTerminalPty(this); }

  async _ptyExecPayload(command) { return buildPtyExecPayload(this, command); }

  async executePtyCommand(command) { return runPtyCommand(this, command); }

  async _executePtyCommandOnce(command) { return runPtyCommandOnce(this, command); }

  resolveSshTarget(targetId) { return resolveTerminalSshTarget(this, targetId); }

  async executeSshCommand(command, body = {}) { return runSshCommand(this, command, body); }

  parseMcpInvocation(command, body = {}) { return parseTerminalMcpInvocation(this, command, body); }

  async executeMcpCommand(command, body = {}) { return runMcpCommand(this, command, body); }

  async scheduleTunnelHealthAlarm() {
    try {
      const existing = await this.ctx.storage.getAlarm();
      if (existing == null) {
        await this.ctx.storage.setAlarm(Date.now() + TUNNEL_HEALTH_ALARM_INTERVAL_MS);
      }
    } catch (_) {}
  }

  async alarm() {
    pruneTurnOutbox(this.sql);
    const clients = this.ctx.getWebSockets(TERMINAL_WS_TAG).length;
    if (clients <= 0) return;
    try {
      const result = await pingTunnelHealth(this.env);
      const payload = JSON.stringify({
        type: "tunnel_health",
        healthy: result?.healthy === true,
        connections: result?.healthy === true ? 1 : 0,
        status: result?.status || "unknown",
      });
      for (const ws of this.ctx.getWebSockets(TERMINAL_WS_TAG)) {
        try { ws.send(payload); } catch (_) {}
      }
    } catch (_) {}
    try {
      await this.ctx.storage.setAlarm(Date.now() + TUNNEL_HEALTH_ALARM_INTERVAL_MS);
    } catch (_) {}
  }

  async webSocketMessage(ws, message) { return handleTerminalSocketMessage(this, ws, message); }

  async webSocketClose(ws) { return handleTerminalSocketClose(this, ws); }

  async webSocketError(ws) { return handleTerminalSocketError(this, ws); }
}
