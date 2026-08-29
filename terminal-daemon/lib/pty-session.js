import { routeInput } from "../router.js";
import { updateTerminalState } from "../context-manager.js";
import {
  log,
  safeSend,
  WORKER_URL,
  TOKEN,
  sessions,
  PORT,
  MAX_BUFFER,
} from "./pty-env.js";
import {
  armSessionInactivityTimer,
  startSessionSweeper,
  collectSessionStats,
} from "./session-lifecycle.js";

export { armSessionInactivityTimer } from "./session-lifecycle.js";
export { shouldAutoAssistOnOutput } from "./assist-policy.js";

export function trimBuffer(lines) {
  while (lines.length > MAX_BUFFER) lines.shift();
}

startSessionSweeper();

export async function handleAssist(session, params) {
  const write = (str) => {
    session.clients.forEach((c) => safeSend(c, str));
  };
  write(
    "\r\n\x1b[2m\x1b[38;2;88;110;117m" +
      "── Agent Sam ─────────────────────────────" +
      "\x1b[0m\r\n"
  );
  try {
    const res = await fetch(`${WORKER_URL}/api/terminal/assist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        ...params,
        session_id: session.id ?? null,
        workspace_id: session.workspaceId || process.env.IAM_PTY_WORKSPACE_ID || null,
        user_id: session.userId || process.env.IAM_PTY_USER_ID || null,
        tenant_id: session.tenantId || process.env.IAM_PTY_TENANT_ID || null,
        model_key: params.model_key || session.preferredModelKey || null,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = data?.detail || data?.error || String(res.status);
      throw new Error(`${res.status} ${detail}`);
    }
    const text = data?.text;
    if (text == null || String(text).trim() === "") {
      throw new Error("empty assist text");
    }
    write(
      "\x1b[38;2;147;161;161m" +
        wrapText(text, 76) +
        "\x1b[0m\r\n" +
        "\x1b[2m\x1b[38;2;88;110;117m" +
        "────────────────────────────────────────" +
        "\x1b[0m\r\n"
    );
  } catch (err) {
    const msg = err && err.message ? String(err.message) : "assist unavailable";
    log(`handleAssist: ${msg}`);
    write("\x1b[38;2;220;50;47m  Agent Sam assist unavailable\x1b[0m\r\n");
    write("\x1b[2m  " + msg.slice(0, 160) + "\x1b[0m\r\n");
  }
}

export function ptyWrite(session, text) {
  if (session?.term) session.term.write(text);
  else if (session?.pty) session.pty.write(text);
  else session?.clients?.forEach((c) => safeSend(c, text));
}

export async function handleSlashStatus(session) {
  const stats = collectSessionStats();
  ptyWrite(
    session,
    `\r\n\x1b[38;5;51m  PTY\x1b[0m ${process.platform} · port ${PORT}` +
      `\r\n  active ${stats.active_sessions} · grace ${stats.disconnected_grace_sessions}` +
      ` · clients ${stats.clients_total} · tracked ${stats.sessions_tracked}` +
      `\r\n  worker ${WORKER_URL}` +
      `\r\n  model ${session.preferredModelKey || "(auto from agentsam_model_catalog)"}\r\n`,
  );
}

export function handleSlashClear(session) {
  ptyWrite(session, "\x1b[2J\x1b[H");
}

export async function handleSlashCompact(session) {
  const { compactIfNeeded } = await import("../context-manager.js");
  compactIfNeeded(session);
  ptyWrite(session, "\r\n\x1b[2m  session context compacted\x1b[0m\r\n");
}

export async function handleSlashAgents(session) {
  ptyWrite(session, "\r\n\x1b[38;5;51m  Agent Sam — agentsam_model_catalog\x1b[0m\r\n");
  try {
    const url = new URL(`${WORKER_URL}/api/terminal/models`);
    if (session?.id) url.searchParams.set("session_id", session.id);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(data?.models)) {
      ptyWrite(session, "\x1b[38;5;196m  could not load model catalog\x1b[0m\r\n");
      return;
    }
    for (const m of data.models) {
      const key = String(m.model_key || "").padEnd(28);
      const label = m.name ? String(m.name) : m.model_key;
      const provider = m.provider ? String(m.provider) : "—";
      ptyWrite(session, `\x1b[38;5;250m  ${key}\x1b[0m \x1b[38;5;240m${provider}\x1b[0m  ${label}\r\n`);
    }
    ptyWrite(session, "\x1b[2m  use /model <model_key> to override auto routing\x1b[0m\r\n");
  } catch (e) {
    ptyWrite(session, `\x1b[38;5;196m  ${e.message}\x1b[0m\r\n`);
  }
}

export function wrapText(text, width) {
  const indent = "  ";
  const vis = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
  return String(text == null ? "" : text)
    .split("\n")
    .map((line) => {
      if (vis(line).length <= width) return indent + line;
      const words = line.split(" ");
      const out = [];
      let cur = indent;
      for (const w of words) {
        if (vis(cur).length + vis(w).length + 1 > width) {
          out.push(cur);
          cur = indent + w;
        } else {
          cur += (cur === indent ? "" : " ") + w;
        }
      }
      if (vis(cur) !== indent) out.push(cur);
      return out.join("\n");
    })
    .join("\n");
}

/** Route WS payload to PTY. Only treat JSON as protocol if it is an object with a known type (avoids swallowing user text that parses as JSON). */
export async function routeMessageToPty(raw, term, session) {
  const s = typeof raw === "string" ? raw : raw.toString();
  if (s.startsWith("{")) {
    try {
      const m = JSON.parse(s);
      if (m && typeof m === "object" && !Array.isArray(m)) {
        if (m.type === "slash" && m.line != null) {
          const line = String(m.line);
          const asInput = JSON.stringify({
            type: "input",
            data: line.endsWith("\n") ? line : `${line}\n`,
          });
          await routeMessageToPty(asInput, term, session);
          return;
        }
        if (m.type === "input" && m.data != null) {
          const dataStr = typeof m.data === "string" ? m.data : String(m.data);
          if (session) {
            if (/^[1-5]\r?\n$/.test(dataStr)) {
              const write = (str) => session.clients.forEach((c) => safeSend(c, str));
              write("\r\n\x1b[2m  use /status, /agents, /compact, /clear, /mcp-builder\x1b[0m\r\n");
              return;
            }
            const trimmed = dataStr.trim();
            if (
              trimmed.startsWith("/explain ") ||
              trimmed.startsWith("/ask ") ||
              trimmed === "/help"
            ) {
              await handleAssist(session, {
                mode: trimmed.startsWith("/ask") ? "ask" : "explain",
                command: null,
                context:
                  trimmed === "/help"
                    ? "available slash commands: /explain /ask /fix /help"
                    : trimmed.split(" ").slice(1).join(" "),
                output: session.outputBuffer.slice(-20).join(""),
                exit_code: null,
              });
              return;
            }
            if (trimmed === "/fix") {
              await handleAssist(session, {
                mode: "fix",
                command: session.lastCommand,
                context: null,
                output: session.outputBuffer.slice(-20).join(""),
                exit_code: null,
              });
              return;
            }
            if (trimmed === "/status") {
              await handleSlashStatus(session);
              return;
            }
            if (trimmed === "/compact") {
              await handleSlashCompact(session);
              return;
            }
            if (trimmed === "/clear") {
              handleSlashClear(session);
              return;
            }
            if (trimmed === "/agents") {
              await handleSlashAgents(session);
              return;
            }
            if (trimmed === "/mcp-builder") {
              await handleAssist(session, {
                mode: "agent",
                context:
                  "Help me build or modify an MCP tool. Show me available tools and suggest what to build next based on current usage gaps.",
                command: session.lastCommand,
                output: session.outputBuffer.slice(-10).join(""),
                exit_code: null,
              });
              return;
            }
            if (trimmed.startsWith("/model ")) {
              const key = trimmed.slice(7).trim();
              if (!key || key === "auto") {
                session.preferredModelKey = null;
                ptyWrite(session, "\r\n\x1b[2m  model routing: auto (agentsam_model_catalog)\x1b[0m\r\n");
              } else {
                session.preferredModelKey = key;
                ptyWrite(session, `\r\n\x1b[38;5;82m  model set: ${key}\x1b[0m\r\n`);
              }
              return;
            }

            if (dataStr.endsWith("\n") && !trimmed.startsWith("/")) {
              session.lastCommand = trimmed;
              updateTerminalState(session, { command: trimmed });

              const { route, query } = routeInput(trimmed, session);

              if (route === "chat_local" || route === "hybrid" || route === "agent_cloud") {
                term.write("\u0015");
              }

              if (route === "chat_local" || route === "hybrid") {
                await handleAssist(session, {
                  mode: "ask",
                  context: query,
                  command: session.lastCommand,
                  output: session.outputBuffer.slice(-20).join(""),
                  exit_code: null,
                });
                return;
              }

              if (route === "agent_cloud") {
                await handleAssist(session, {
                  mode: "agent",
                  context: query,
                  command: session.lastCommand,
                  output: session.outputBuffer.slice(-20).join(""),
                  exit_code: null,
                });
                return;
              }
            }
          }
          term.write(dataStr);
          return;
        }
        if (m.type === "resize" && m.cols != null && m.rows != null) {
          try {
            term.resize(Number(m.cols), Number(m.rows));
          } catch (_) {}
          return;
        }
        if (m.type === "run" && m.command != null) {
          term.write(String(m.command) + "\n");
          return;
        }
      }
    } catch (_) {
      /* fall through to raw */
    }
  }
  term.write(s);
}
