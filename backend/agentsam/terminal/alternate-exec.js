const DEFAULT_MCP_ENDPOINT = 'https://mcp.inneranimalmedia.com/mcp';
export function parseSshTargets(env) {
  try {
    const raw = String(env?.SSH_TARGETS_JSON || '').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.targets) ? parsed.targets : []);
    return list.map((row) => ({
      id: String(row?.id || row?.name || '').trim(), host: String(row?.host || '').trim(),
      user: String(row?.user || '').trim(), port: Number(row?.port || 22) || 22,
    })).filter((row) => row.host && row.user);
  } catch { return []; }
}
function shellSingleQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
}

export function resolveSshTarget(session, targetId) {
    const targets = parseSshTargets(session.env);
    if (targets.length === 0) throw new Error("No SSH targets configured");
    let target = targets[0];
    const wanted = String(targetId || "").trim();
    if (wanted) {
      target = targets.find((row) => row.id === wanted || row.host === wanted) || target;
    }
    if (!target.user || target.user.toLowerCase() === "root") {
      throw new Error("SSH target must use a non-root user");
    }
    return target;
  }

export async function executeSshCommand(session, command, body = {}) {
    const target = session.resolveSshTarget(body?.ssh_target_id || body?.ssh_target);
    const sshCommand =
      `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -p ${target.port} ` +
      `${target.user}@${target.host} -- ${shellSingleQuote(command)}`;
    const out = await session.executePtyCommand(sshCommand);
    return { ...out, target_id: target.id || `${target.user}@${target.host}` };
  }

export function parseMcpInvocation(session, command, body = {}) {
    const directTool = String(body?.tool_name || "").trim();
    if (directTool) {
      return {
        tool_name: directTool,
        params: body?.params && typeof body.params === "object" ? body.params : {},
      };
    }
    const raw = String(command || "").trim().replace(/^\/?mcp\s+/i, "");
    const spaceIdx = raw.indexOf(" ");
    if (spaceIdx < 0) return { tool_name: raw, params: {} };
    const toolName = raw.slice(0, spaceIdx).trim();
    const tail = raw.slice(spaceIdx + 1).trim();
    if (!tail) return { tool_name: toolName, params: {} };
    try {
      return { tool_name: toolName, params: JSON.parse(tail) };
    } catch (_) {
      return { tool_name: toolName, params: { input: tail } };
    }
  }

export async function executeMcpCommand(session, command, body = {}) {
    const token = String(session.env?.MCP_AUTH_TOKEN || "").trim();
    if (!token) throw new Error("MCP_AUTH_TOKEN is not configured");

    const endpoint = String(session.env?.MCP_SERVER_URL || DEFAULT_MCP_ENDPOINT).trim();
    const invoke = session.parseMcpInvocation(command, body);
    if (!invoke.tool_name) throw new Error("MCP tool name is required");

    const rpcBody = {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: {
        name: invoke.tool_name,
        arguments: invoke.params || {},
      },
    };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(rpcBody),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.error) {
      const detail = payload?.error?.message || payload?.error || payload?.detail || `HTTP ${res.status}`;
      return { error: `MCP invoke failed: ${String(detail)}` };
    }
    const result = payload?.result ?? payload;
    return {
      tool_name: invoke.tool_name,
      output: typeof result === "string" ? result : JSON.stringify(result, null, 2),
      exit_code: 0,
    };
  }
