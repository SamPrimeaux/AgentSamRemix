import type { Env } from '../../src/env';

export type TerminalRuntimeScope = {
  userId: string;
  workspaceId: string;
  tenantId?: string | null;
};

function trim(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function websocketKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function socketText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }
  return data == null ? '' : String(data);
}

function closeSocket(socket: WebSocket | null | undefined, code = 1000, reason = 'closed') {
  if (!socket) return;
  try {
    socket.close(code, reason);
  } catch {
    // Already closed.
  }
}

function sendJson(socket: WebSocket, value: unknown) {
  try {
    socket.send(JSON.stringify(value));
  } catch {
    // Socket may have closed between the state check and send.
  }
}

function backendWebSocketHeaders(scope: TerminalRuntimeScope): Headers {
  const headers = new Headers({
    Upgrade: 'websocket',
    Connection: 'Upgrade',
    'Sec-WebSocket-Key': websocketKey(),
    'Sec-WebSocket-Version': '13',
    'X-IAM-Exec-Identity': 'agentsam',
    'X-IAM-Exec-Actor': 'agentsamremix',
    'X-User-Id': scope.userId,
    'X-Workspace-Id': scope.workspaceId,
  });
  if (scope.tenantId) headers.set('X-Tenant-Id', scope.tenantId);
  return headers;
}

function vpcPtyUrl(requestUrl: URL, scope: TerminalRuntimeScope, sessionId: string): URL {
  const url = new URL('http://localhost:3099/terminal');
  url.searchParams.set('user_id', scope.userId);
  url.searchParams.set('workspace_id', scope.workspaceId);
  if (scope.tenantId) url.searchParams.set('tenant_id', scope.tenantId);
  url.searchParams.set('session_id', sessionId);

  for (const key of ['pty_client', 'pty_slot', 'shell', 'cols', 'rows']) {
    const value = trim(requestUrl.searchParams.get(key));
    if (value) url.searchParams.set(key, value);
  }
  const cwd = trim(requestUrl.searchParams.get('cwd'));
  if (cwd) url.searchParams.set('cwd', cwd);
  return url;
}

export function terminalConfigStatus(
  env: Env,
  scope: TerminalRuntimeScope,
  requestUrl: URL,
) {
  const requestedTarget = trim(requestUrl.searchParams.get('target_type')) || 'platform_vm';
  const vpcReady = Boolean(env.PTY_SERVICE?.fetch);
  const supported = requestedTarget === 'platform_vm';
  return {
    ok: true,
    terminal_configured: supported && vpcReady,
    target_type: requestedTarget,
    recommended_target_type: vpcReady ? 'platform_vm' : null,
    transport: supported && vpcReady ? 'vpc' : null,
    connection_id: supported && vpcReady ? 'builtin:pty-service' : null,
    workspace_id: scope.workspaceId,
    reason: supported
      ? vpcReady
        ? null
        : 'pty_service_binding_missing'
      : 'target_not_available_in_remix',
  };
}

/**
 * Bridge the browser xterm socket directly to the bound VPC PTY service.
 *
 * AgentSamRemix owns browser auth and resource scope; PTY_SERVICE owns the host
 * shell. No per-user terminal connection row is required for the built-in VM.
 */
export async function openVpcPtyWebSocket(
  request: Request,
  env: Env,
  scope: TerminalRuntimeScope,
): Promise<Response> {
  if (!env.PTY_SERVICE?.fetch) {
    return Response.json({ error: 'pty_service_binding_missing' }, { status: 503 });
  }
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }

  const requestUrl = new URL(request.url);
  const targetType = trim(requestUrl.searchParams.get('target_type')) || 'platform_vm';
  if (targetType !== 'platform_vm') {
    return Response.json(
      {
        error: 'terminal_target_not_available',
        target_type: targetType,
        available: ['platform_vm'],
      },
      { status: 409 },
    );
  }

  const sessionId = `vpc_${crypto.randomUUID()}`;
  const backendUrl = vpcPtyUrl(requestUrl, scope, sessionId);
  const backendResponse = await env.PTY_SERVICE.fetch(
    new Request(backendUrl.toString(), {
      method: 'GET',
      headers: backendWebSocketHeaders(scope),
    }),
  );
  const backendSocket = backendResponse.webSocket;
  if (backendResponse.status !== 101 || !backendSocket) {
    closeSocket(backendSocket, 1011, 'backend_upgrade_failed');
    return Response.json(
      {
        error: 'vpc_pty_unavailable',
        status: backendResponse.status,
      },
      { status: 502 },
    );
  }

  const pair = new WebSocketPair();
  const [browserSocket, workerSocket] = Object.values(pair);
  workerSocket.accept();
  backendSocket.accept();

  const binding = {
    protocol: 'pty',
    lane: 'remote',
    target_type: 'platform_vm',
    target_id: 'builtin:pty-service',
    host_kind: 'linux',
    transport: 'vpc',
    workspace_id: scope.workspaceId,
    cwd: null,
  };

  workerSocket.addEventListener('message', (event) => {
    try {
      backendSocket.send(event.data);
    } catch {
      sendJson(workerSocket, {
        type: 'state',
        status: 'disconnected',
        error: 'vpc_pty_write_failed',
      });
    }
  });

  backendSocket.addEventListener('message', (event) => {
    const text = socketText(event.data);
    if (!text) return;

    // Preserve backend control messages, but normalize ordinary PTY bytes into
    // the envelope already consumed by the Remix xterm client.
    if (typeof event.data === 'string' && text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text) as { type?: string };
        if (
          parsed?.type === 'session_id' ||
          parsed?.type === 'state' ||
          parsed?.type === 'tunnel_health'
        ) {
          workerSocket.send(text);
          return;
        }
      } catch {
        // Terminal output is allowed to look like JSON.
      }
    }
    sendJson(workerSocket, { type: 'output', data: text });
  });

  workerSocket.addEventListener('close', () => closeSocket(backendSocket));
  workerSocket.addEventListener('error', () => closeSocket(backendSocket, 1011, 'browser_socket_error'));
  backendSocket.addEventListener('close', () => {
    sendJson(workerSocket, { type: 'state', status: 'disconnected', binding });
    closeSocket(workerSocket);
  });
  backendSocket.addEventListener('error', () => {
    sendJson(workerSocket, {
      type: 'state',
      status: 'disconnected',
      error: 'vpc_pty_backend_error',
      binding,
    });
    closeSocket(workerSocket, 1011, 'backend_socket_error');
  });

  sendJson(workerSocket, { type: 'session_id', session_id: sessionId });
  sendJson(workerSocket, { type: 'state', status: 'connected', binding });

  return new Response(null, {
    status: 101,
    webSocket: browserSocket,
  });
}
