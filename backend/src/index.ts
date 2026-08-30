import { routeAgentRequest } from "agents";
import { identityContextFromSdkSession } from "../identity/request-context.js";
import {
  LOGIN_IDP_PROVIDERS,
  OAUTH_TOKEN_PROVIDERS,
  JWT_FORBIDDEN_AUTHZ_CLAIMS,
  IDENTITY_TABLE_ROLES,
} from "../identity/index.js";
import {
  handleIdentityWorkerRequest,
  createCloudflareD1Adapter,
  createIdentityService,
} from "@inneranimalmedia/agentsam-sdk/identity/server/worker-router";
import {
  verifyBridgeKey,
  resolveMachineProof,
  bridgeUnauthorized,
} from "./auth/bridge-key";
import { streamGeminiPage } from "./lib/geminiProxy";
import { resolveProviderCredential } from "../credentials/provider-credential.js";
import {
  destroyTerminalEnvironment,
  executeTerminalLane,
  preferredExecLane,
  rememberExecLane,
  terminalRuntimeStatus,
} from "../agentsam/terminal/runtime";
import {
  openVpcPtyWebSocket,
  terminalConfigStatus,
} from "../agentsam/terminal/interactive";
import { probeExecOS } from "../agentsam/terminal/execos";
import {
  isExecLane,
  resolveUserRuntimeScope,
  type ExecLane,
} from "../agentsam/terminal/registry";
import { handleRetrievalHttpRequest } from "../http/retrieval/routes.js";
import { handleBrowserLiveViewHttpRequest } from "../http/browser/live-view.js";
import { handleSettingsRequest } from "../http/settings/index.js";
import type { Env } from "./env";
import { handleAgentRequest } from "../http/agentsam/index.js";
import {
  agentSamConversationIdFromPath,
  userOwnsAgentSamConversation,
} from "../agentsam/runtime/http-auth";
import { fetchWebsiteAsset, websiteAssetsFetcher } from "../worker/website-assets";

export { AgentSam } from "../agentsam/runtime/AgentSam";
export { CodemodeRuntime } from "@cloudflare/codemode";
export { Sandbox } from "@cloudflare/sandbox";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function trim(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

async function authenticatedRuntimeScope(env: Env, requestIdentity: any) {
  const userId = trim(requestIdentity?.user?.id);
  if (!userId) return null;
  const workspaceId = trim(
    requestIdentity?.workspace?.id ||
      requestIdentity?.workspace?.storedActiveId,
  );
  const tenantId = trim(requestIdentity?.tenant?.id) || null;
  if (workspaceId) return { userId, workspaceId, tenantId };
  return resolveUserRuntimeScope(env, userId);
}

async function machineRuntimeScope(env: Env, request: Request, body: any) {
  const userId = trim(
    request.headers.get("X-User-Id") || body?.userId || body?.user_id,
  );
  if (!userId) return null;
  const explicitWorkspaceId = trim(
    request.headers.get("X-Workspace-Id") ||
      body?.workspaceId ||
      body?.workspace_id,
  );
  const explicitTenantId = trim(
    request.headers.get("X-Tenant-Id") || body?.tenantId || body?.tenant_id,
  );
  if (explicitWorkspaceId) {
    return {
      userId,
      workspaceId: explicitWorkspaceId,
      tenantId: explicitTenantId || null,
    };
  }
  const resolved = await resolveUserRuntimeScope(env, userId);
  if (!resolved) return null;
  return { ...resolved, tenantId: explicitTenantId || resolved.tenantId };
}

function laneForLegacyMachinePath(pathname: string): ExecLane | null {
  if (pathname === "/api/terminal/local") return "local";
  if (pathname === "/api/terminal/vm") return "remote";
  if (pathname === "/api/terminal/sandbox") return "sandbox";
  if (pathname === "/api/terminal/environment") return "environment";
  return null;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    const identityAdapter = createCloudflareD1Adapter(env.DB);
    const identity = createIdentityService({ adapter: identityAdapter });
    const identityEnv = { ...env, ASSETS: websiteAssetsFetcher(env.WEBSITE_ASSETS) };

    if (url.pathname === "/" && request.method === "GET") {
      return fetchWebsiteAsset(env.WEBSITE_ASSETS, request, { key: "site/home.html" });
    }

    if (url.pathname === "/workbench" || url.pathname === "/agent/workbench") {
      return Response.redirect(
        new URL("/dashboard/home", request.url).toString(),
        308,
      );
    }

    if (url.pathname === "/api/identity/health" && request.method === "GET") {
      return json({
        ok: true,
        owner: "app/backend/identity",
        loginProviders: LOGIN_IDP_PROVIDERS,
        tokenProviders: OAUTH_TOKEN_PROVIDERS,
        tableRoles: IDENTITY_TABLE_ROLES,
        forbiddenJwtAuthzClaims: JWT_FORBIDDEN_AUTHZ_CLAIMS,
      });
    }

    if (
      url.pathname === "/api/agent/retrieval/query" ||
      url.pathname === "/api/agent/retrieval/eval"
    ) {
      const machineProof = resolveMachineProof(request, env);
      if (machineProof) {
        const response = await handleRetrievalHttpRequest(request, env, {
          authType: "service",
          machineProof,
        });
        return response || json({ error: "retrieval_route_not_found" }, 404);
      }
    }

    const machineLane = laneForLegacyMachinePath(url.pathname);
    if (machineLane && request.method === "POST") {
      if (!verifyBridgeKey(request, env)) return bridgeUnauthorized();
      const body = (await request.json().catch(() => null)) as any;
      const scope = await machineRuntimeScope(env, request, body);
      if (!scope) return json({ error: "execution_identity_required" }, 400);
      const result = await executeTerminalLane(env, {
        ...scope,
        lane: machineLane,
        command: body?.command || "",
        cwd: body?.cwd,
        connectionId: body?.connectionId || body?.connection_id,
      });
      return json(result, result.ok ? 200 : 502);
    }

    if (
      url.pathname.startsWith("/api/auth") ||
      url.pathname.startsWith("/api/oauth") ||
      url.pathname.startsWith("/auth")
    ) {
      const authResponse = await handleIdentityWorkerRequest(
        request,
        identityEnv,
        { identity },
      );
      if (authResponse.status !== 404) return authResponse;
    }

    let session: any = null;
    try {
      session = await identity.sessionFromRequest(request);
    } catch (error) {
      console.warn("[auth] session resolution failed", error);
    }
    const authenticated = Boolean(session?.user);
    const requestIdentity = identityContextFromSdkSession(session);

    if (url.pathname === "/api/identity/me" && request.method === "GET") {
      return authenticated
        ? json({ ok: true, identity: requestIdentity })
        : json({ ok: false, error: "session_required" }, 401);
    }

    // Browser terminal control plane. Keep this before the generic /api/agent
    // dispatcher so the imported terminal UI cannot be swallowed by a legacy
    // route family that does not own the VPC PTY WebSocket.
    if (
      url.pathname === "/api/agent/terminal/config-status" &&
      request.method === "GET"
    ) {
      if (!authenticated) return json({ error: "session_required" }, 401);
      const scope = await authenticatedRuntimeScope(env, requestIdentity);
      if (!scope) return json({ error: "workspace_scope_required" }, 409);
      return json(terminalConfigStatus(env, scope, url));
    }

    if (
      url.pathname === "/api/agent/terminal/ws" &&
      request.method === "GET"
    ) {
      if (!authenticated) return json({ error: "session_required" }, 401);
      const scope = await authenticatedRuntimeScope(env, requestIdentity);
      if (!scope) return json({ error: "workspace_scope_required" }, 409);
      return openVpcPtyWebSocket(request, env, scope);
    }

    if (
      url.pathname === "/api/terminal/session/resume" &&
      request.method === "GET"
    ) {
      if (!authenticated) return json({ error: "session_required" }, 401);
      return json({ ok: true, resumable: false, session_id: null });
    }

    if (
      url.pathname === "/api/terminal/session/close" &&
      request.method === "POST"
    ) {
      if (!authenticated) return json({ error: "session_required" }, 401);
      return json({ ok: true });
    }

    // xterm's offline fallback. Interactive input normally travels over the VPC
    // WebSocket; this keeps command execution useful during a reconnect.
    if (
      url.pathname === "/api/agent/terminal/run" &&
      request.method === "POST"
    ) {
      if (!authenticated) return json({ error: "session_required" }, 401);
      const scope = await authenticatedRuntimeScope(env, requestIdentity);
      if (!scope) return json({ error: "workspace_scope_required" }, 409);
      const body = (await request.json().catch(() => null)) as any;
      const result = await executeTerminalLane(env, {
        ...scope,
        lane: "remote",
        command: body?.command || "",
        cwd: body?.cwd,
      });
      return json(
        {
          ok: result.ok,
          error: result.ok ? null : result.error,
          command: body?.command || "",
          output: result.text || result.stdout || result.stderr || "",
          exit_code: result.exitCode,
          execution_id: null,
          transport: result.transport || null,
        },
        result.ok ? 200 : 502,
      );
    }

    if (
      url.pathname === "/api/agent/terminal/complete" &&
      request.method === "POST"
    ) {
      if (!authenticated) return json({ error: "session_required" }, 401);
      return json({ ok: true });
    }

    if (
      url.pathname.startsWith("/api/agent/") ||
      url.pathname.startsWith("/api/agentsam/")
    ) {
      const scope = authenticated
        ? await authenticatedRuntimeScope(env, requestIdentity)
        : null;
      const response = await handleAgentRequest(request, env, _ctx, {
        identity:
          authenticated && scope
            ? {
                userId: scope.userId,
                workspaceId: scope.workspaceId,
                tenantId: scope.tenantId,
                email: requestIdentity.user.email,
                displayName: requestIdentity.user.displayName,
              }
            : null,
        routeAuth: { authCtx: null, authUser: session?.user || null },
        ingestBypass: false,
        planServices: null,
        chatServices: null,
      });
      if (response) return response;
    }

    if (url.pathname.startsWith("/agents/")) {
      if (!authenticated) return json({ error: "session_required" }, 401);
      const userId = trim(requestIdentity?.user?.id);
      if (!userId) return json({ error: "auth_user_id_required" }, 401);

      // The browser may address only the AgentSam Durable Object whose instance
      // name is an agentsam_chat_sessions.conversation_id owned by this user.
      // Do this D1 check before routeAgentRequest wakes or connects to the DO.
      const conversationId = agentSamConversationIdFromPath(url.pathname);
      if (!conversationId) return json({ error: "agent_route_not_found" }, 404);
      const ownsConversation = await userOwnsAgentSamConversation(
        env,
        userId,
        conversationId,
      );
      if (!ownsConversation) return json({ error: "agent_conversation_not_found" }, 404);

      const response = await routeAgentRequest(request, env, {
        props: { userId, conversationId },
      });
      return response || json({ error: "agent_route_not_found" }, 404);
    }

    if (url.pathname.startsWith("/api/settings/")) {
      if (!authenticated) return json({ error: "session_required" }, 401);
      const scope = await authenticatedRuntimeScope(env, requestIdentity);
      if (!scope) return json({ error: "workspace_scope_required" }, 409);
      const response = await handleSettingsRequest(
        request,
        env,
        requestIdentity,
        scope,
      );
      return response || json({ error: "settings_route_not_found" }, 404);
    }

    if (url.pathname === "/api/agent/retrieval/query") {
      if (!authenticated) return json({ error: "session_required" }, 401);
      const scope = await authenticatedRuntimeScope(env, requestIdentity);
      if (!scope) return json({ error: "workspace_scope_required" }, 409);
      const response = await handleRetrievalHttpRequest(request, env, scope);
      return response || json({ error: "retrieval_route_not_found" }, 404);
    }

    if (url.pathname === "/api/exec/status" && request.method === "GET") {
      if (!authenticated) return json({ error: "session_required" }, 401);
      const scope = await authenticatedRuntimeScope(env, requestIdentity);
      if (!scope) return json({ error: "workspace_scope_required" }, 409);
      return json(await terminalRuntimeStatus(env, scope));
    }

    if (url.pathname === "/api/exec/preference" && request.method === "PUT") {
      if (!authenticated) return json({ error: "session_required" }, 401);
      const scope = await authenticatedRuntimeScope(env, requestIdentity);
      if (!scope) return json({ error: "workspace_scope_required" }, 409);
      const body = (await request.json().catch(() => null)) as {
        lane?: string;
      } | null;
      if (!isExecLane(body?.lane))
        return json({ error: "exec_lane_invalid" }, 400);
      await rememberExecLane(env, scope.userId, scope.workspaceId, body.lane);
      return json({ ok: true, lane: body.lane });
    }

    if (url.pathname === "/api/exec/run" && request.method === "POST") {
      if (!authenticated) return json({ error: "session_required" }, 401);
      const scope = await authenticatedRuntimeScope(env, requestIdentity);
      if (!scope) return json({ error: "workspace_scope_required" }, 409);
      const body = (await request.json().catch(() => null)) as any;
      const lane = isExecLane(body?.lane)
        ? body.lane
        : await preferredExecLane(env, scope.userId, scope.workspaceId);
      const result = await executeTerminalLane(env, {
        ...scope,
        lane,
        command: body?.command || "",
        cwd: body?.cwd,
        connectionId: body?.connectionId || body?.connection_id,
      });
      return json(result, result.ok ? 200 : 502);
    }

    if (
      url.pathname === "/api/exec/environment" &&
      request.method === "DELETE"
    ) {
      if (!authenticated) return json({ error: "session_required" }, 401);
      const scope = await authenticatedRuntimeScope(env, requestIdentity);
      if (!scope) return json({ error: "workspace_scope_required" }, 409);
      const result = await destroyTerminalEnvironment(env, scope);
      return json(result, result.ok ? 200 : 502);
    }

    if (url.pathname === "/api/exec/host" && request.method === "POST") {
      if (!authenticated) return json({ error: "session_required" }, 401);
      const scope = await authenticatedRuntimeScope(env, requestIdentity);
      if (!scope) return json({ error: "workspace_scope_required" }, 409);
      const body = (await request.json().catch(() => null)) as any;
      const result = await executeTerminalLane(env, {
        ...scope,
        lane: "remote",
        command: body?.command || "",
        cwd: body?.cwd,
      });
      return json(result, result.ok ? 200 : 502);
    }

    if (url.pathname === "/api/browser/live-view") {
      if (!authenticated) return json({ error: "session_required" }, 401);
      const userId = trim(requestIdentity?.user?.id);
      if (!userId) return json({ error: "user_scope_required" }, 409);
      const response = await handleBrowserLiveViewHttpRequest(request, env, {
        userId,
      });
      return response || json({ error: "browser_route_not_found" }, 404);
    }

    if (url.pathname === "/api/gemini/generate" && request.method === "POST") {
      if (!authenticated) return json({ error: "Unauthorized" }, 401);
      const apiKey = await resolveProviderCredential(env, {
        userId: requestIdentity.user.id,
        tenantId: requestIdentity.tenant.id,
        provider: "google",
      });
      if (!apiKey) return json({ error: "no_google_ai_key_configured" }, 503);
      const body = (await request.json().catch(() => null)) as any;
      if (!body?.prompt) return json({ error: "prompt_required" }, 400);
      return streamGeminiPage(apiKey, body, request.signal);
    }

    if (url.pathname === "/api/vision/analyze")
      return json({ error: "not_implemented" }, 501);
    if (url.pathname === "/api/mission/execute")
      return json({ error: "use_agent_chat" }, 410);

    if (url.pathname === "/api/health") {
      const execos = await probeExecOS(env);
      return json({
        status: "ok",
        runtime: "cloudflare-worker",
        agent: "Think",
        codeMode: true,
        browserRun: Boolean(env.MYBROWSER),
        browserSessionAuthority: "AgentSam",
        execos: execos.ok,
        vpc: Boolean(env.PTY_SERVICE),
        sandbox: Boolean(env.MY_CONTAINER),
        environment: Boolean(execos.ok && execos.environmentConfigured),
        sessionCache: Boolean(env.SESSION_CACHE),
      });
    }

    if (url.pathname.startsWith("/website-assets/")) {
      return fetchWebsiteAsset(env.WEBSITE_ASSETS, request);
    }

    if (url.pathname.startsWith("/api/"))
      return json({ error: "not_found" }, 404);
    if (request.method === "GET") {
      return fetchWebsiteAsset(env.WEBSITE_ASSETS, request, { spaFallback: true });
    }
    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
