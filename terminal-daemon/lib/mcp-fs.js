import { spawn } from "child_process";
import { existsSync, accessSync, constants as fsConstants } from "fs";
import { log } from "./pty-env.js";

// ─── Persistent MCP Filesystem Process ───────────────────────────────────────
let mcpFsProcess = null;
let mcpFsReady = false;
let pendingRequests = new Map();
let reqIdCounter = 1;

function splitPathList(raw) {
  return String(raw || "")
    .split(/[:,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isReadableDir(dir) {
  try {
    if (!dir || !existsSync(dir)) return false;
    accessSync(dir, fsConstants.R_OK);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Resolve accessible allow-roots for @modelcontextprotocol/server-filesystem.
 *
 * Operator work uses real git clones (EXECOS_DEFAULT_CWD / SAM_OPERATOR_REPO_PATHS).
 * Tenant isolation stays under IAM_WORKSPACES_ROOT (/workspace). Never invent
 * HOME+"/inneranimalmedia" — agentsam HOME is /var/lib/agentsam and that path
 * does not exist.
 *
 * @returns {string[]}
 */
export function resolveMcpFsRoots() {
  const candidates = [
    ...splitPathList(process.env.EXECOS_MCP_FS_ROOTS),
    ...splitPathList(process.env.SAM_OPERATOR_REPO_PATHS),
    (process.env.EXECOS_DEFAULT_CWD || "").trim(),
    (process.env.IAM_GCP_OPERATOR_REPO || "").trim(),
    (process.env.IAM_WORKSPACES_ROOT || "").trim(),
    "/workspace",
  ].filter(Boolean);

  const seen = new Set();
  const roots = [];
  for (const dir of candidates) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    if (isReadableDir(dir)) roots.push(dir);
  }
  return roots.length ? roots : ["/tmp"];
}

/** @deprecated Prefer resolveMcpFsRoots(); kept for callers/tests. */
export function resolveMcpFsRoot() {
  return resolveMcpFsRoots()[0] || "/tmp";
}

export function getMcpFsProcess() {
  if (mcpFsProcess && !mcpFsProcess.killed) return mcpFsProcess;

  const roots = resolveMcpFsRoots();
  log(`Spawning persistent MCP filesystem process (roots=${roots.join(",")})...`);
  mcpFsProcess = spawn(
    "npx",
    ["-y", "@modelcontextprotocol/server-filesystem", ...roots],
    {
      env: { ...process.env, HOME: process.env.HOME },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  let buf = "";
  mcpFsProcess.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const id = msg.id;
        if (pendingRequests.has(id)) {
          const { resolve } = pendingRequests.get(id);
          pendingRequests.delete(id);
          resolve(msg);
        }
      } catch (_) {}
    }
  });

  mcpFsProcess.stderr.on("data", (d) => {
    const txt = d.toString();
    if (/running on stdio/i.test(txt)) {
      log("MCP Filesystem server is ready.");
      mcpFsReady = true;
    } else {
      const trimmed = txt.trim();
      if (trimmed) log(`MCP Filesystem stderr: ${trimmed.slice(0, 500)}`);
    }
  });

  mcpFsProcess.on("exit", (code) => {
    log(`MCP Filesystem server exited with code ${code}`);
    mcpFsProcess = null;
    mcpFsReady = false;
  });

  return mcpFsProcess;
}

export const toolMap = {
  fs_read_file: "read_text_file",
  fs_read_media: "read_media_file",
  fs_read_multiple: "read_multiple_files",
  fs_write_file: "write_file",
  fs_edit_file: "edit_file",
  fs_create_directory: "create_directory",
  fs_list_directory: "list_directory",
  fs_list_directory_sizes: "list_directory_with_sizes",
  fs_move_file: "move_file",
  fs_search_files: "search_files",
  fs_directory_tree: "directory_tree",
  fs_get_file_info: "get_file_info",
  fs_list_allowed_dirs: "list_allowed_directories",
};

/**
 * Send one JSON-RPC tools/call request to the persistent MCP filesystem
 * process and resolve with its result. Encapsulates the module's private
 * pendingRequests/reqIdCounter/mcpFsReady state so callers (http-routes.js)
 * never touch it directly.
 * @param {{ tool_name?: string, parameters?: object, params?: { name?: string, arguments?: object, params?: object } }} rpc
 * @returns {Promise<{ ok: true, result: any }>}
 */
export async function callMcpFilesystem(rpc) {
  const proc = getMcpFsProcess();

  // Wait for ready if not already
  if (!mcpFsReady) {
    log("Waiting for MCP server to stabilize...");
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!mcpFsReady || !proc || proc.killed) {
    throw new Error(
      `MCP filesystem not ready (roots=${resolveMcpFsRoots().join(",")}). Check ExecOS logs for spawn stderr.`,
    );
  }

  const id = reqIdCounter++;
  const mcpToolName = toolMap[rpc.tool_name] || rpc.tool_name || toolMap[rpc.params?.name] || rpc.params?.name;
  const parameters = rpc.parameters || rpc.params?.arguments || rpc.params?.params || {};

  const request = {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: mcpToolName, arguments: parameters },
  };

  log(`[MCP] sending request: ${JSON.stringify(request)}`);

  const result = await new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error("MCP timeout"));
      }
    }, 15000);
    proc.stdin.write(JSON.stringify(request) + "\n");
  });

  const content = result?.result?.content;
  if (Array.isArray(content)) {
    const text = content.map((c) => c.text || "").join("");
    return { ok: true, result: text };
  }
  return { ok: true, result: result?.result || result };
}
