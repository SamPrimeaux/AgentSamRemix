
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const SESSION_DIR = join(process.env.HOME || '~', '.iam-pty', 'sessions');
if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });

export function persistSession(session) {
  if (!session?.id || !session?.memory) return;
  try {
    const path = join(SESSION_DIR, `${session.id}.json`);
    writeFileSync(path, JSON.stringify({
      id: session.id,
      memory: session.memory,
      savedAt: Date.now(),
    }, null, 2));
  } catch (_) {}
  scheduleSessionSnapshot(session);
}

/**
 * Best-effort R2 snapshot via CORE internal API (Sprint 1A context tier).
 * @param {any} session
 */
export function scheduleSessionSnapshot(session) {
  if (!session?.id || !session?.memory) return;
  const workerUrl = (process.env.WORKER_URL || 'https://inneranimalmedia.com').replace(/\/+$/, '');
  const secret = (process.env.AGENTSAM_BRIDGE_KEY || process.env.EXECOS_KEY || '').trim();
  if (!secret) return;

  const tenantId = (process.env.TENANT_ID || process.env.DEFAULT_TENANT_ID || "").trim();
  const userId = String(session.userId || "").trim();
  if (!tenantId || !userId) return;

  const payload = {
    tenant_id: tenantId,
    user_id: userId,
    session_id: String(session.id),
    memory: session.memory,
    terminal_state: session.memory?.terminalState ?? null,
    source: 'execos',
  };

  fetch(`${workerUrl}/api/internal/exec/context/snapshot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(payload),
  }).catch((e) => {
    console.warn('[context-manager] R2 snapshot failed', e?.message ?? e);
  });
}

export function restoreSession(session) {
  if (!session?.id) return;
  try {
    const path = join(SESSION_DIR, `${session.id}.json`);
    if (!existsSync(path)) return;
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    if (saved?.memory) {
      session.memory = { ...session.memory, ...saved.memory };
    }
  } catch (_) {}
}

/**
 * IAM PTY — Context Manager
 * Owns session memory, context envelope, and compaction.
 *
 * Layers:
 *   A: system_contract   — immutable identity
 *   B: workspace_memory  — repo, stack, project facts
 *   C: task_summary      — current objective
 *   D: recent_turns      — last N exchanges
 *   E: terminal_state    — cwd, command, errors, output
 *
 * Compaction: soft 14K → summarize oldest turns
 *             hard 20K → force snapshot + clear
 */
import { execSync } from 'child_process';

export function estimateTokens(str) {
  return Math.ceil((str || '').length / 4);
}

const SOFT_LIMIT = 14_000;
const HARD_LIMIT = 20_000;

export function initSessionMemory(session) {
  session.memory = {
    pinned: {
      repo:        process.env.EXECOS_DEFAULT_CWD
        || process.env.IAM_GCP_OPERATOR_REPO
        || process.env.IAM_WORKSPACES_ROOT
        || '/workspace',
      tenant:      process.env.TENANT_DISPLAY || 'Inner Animal Media',
      stack:       'Cloudflare Workers + D1 + KV + R2 + Vite/React',
      deploy_rule: 'sandbox first → never npx wrangler deploy alone',
    },
    taskSummary:     '',
    sessionSummary:  '',
    recentTurns:     [],
    activeObjective: '',
    unresolvedError: '',
    selectedFile:    '',
    terminalState: {
      cwd:          session.cwd || process.env.HOME,
      lastCommand:  '',
      exitCode:     null,
      gitBranch:    '',
      changedFiles: [],
      stderrTail:   '',
      outputTail:   [],
    },
    metrics: [],
  };
}

export function updateTerminalState(session, { command, exitCode, stderr } = {}) {
  const mem = session.memory;
  if (!mem) return;
  const ts = mem.terminalState;
  if (command)             ts.lastCommand = command;
  if (exitCode !== undefined) ts.exitCode = exitCode;
  if (stderr)              ts.stderrTail = stderr.slice(-400);

  try {
    const branch = execSync('git branch --show-current 2>/dev/null', {
      cwd: (ts.cwd || process.env.HOME).replace('~', process.env.HOME),
      timeout: 800,
    }).toString().trim();
    if (branch) ts.gitBranch = branch;
  } catch (_) {}

  const rawOutput = (session.outputBuffer || []).slice(-30).join('');
  ts.outputTail = rawOutput
    .split(/\r?\n/)
    .map(l => l.replace(/\x1b\[[0-9;]*[mGKHF]/g, '').trim())
    .filter(l => l.length > 0 && l.length < 200)
    .slice(-15);

  const errorLine = ts.outputTail.find(l =>
    /error|failed|ENOENT|EACCES|npm ERR|wrangler:error|undefined|cannot|exception/i.test(l)
  );
  if (errorLine) mem.unresolvedError = errorLine.slice(0, 200);
}

export function buildContextEnvelope(session, userMessage) {
  const mem = session.memory || {};
  const ts  = mem.terminalState || {};
  const pin = mem.pinned || {};

  const systemContract = `You are Agent Sam, AI assistant built into the IAM terminal for Sam Primeaux, CEO of Inner Animal Media.
Stack: Cloudflare Workers + D1 + R2 + KV + Vite/React. Repo: /Users/samprimeaux/inneranimalmedia-agentsam-dashboard.
Deploy rule: sandbox first via deploy-sandbox.sh, then promote-to-prod.sh. Never npm run deploy alone.
Models: resolved from agentsam_model_catalog via Worker /api/terminal/assist (task terminal_execution). User may override with /model <model_key> after /agents.
No emojis. No markdown headers. Dashes not asterisks. Max 15 lines. Plain text only.
Be direct and technical. Reference actual files, tables, and routes when relevant.
Never execute shell commands — propose them for user approval.`;

  const workspaceMem = [
    `Repo: ${pin.repo || '~/inneranimalmedia'}`,
    mem.taskSummary    ? `Task: ${mem.taskSummary}` : '',
    mem.sessionSummary ? `Session: ${mem.sessionSummary}` : '',
  ].filter(Boolean).join('\n');

  const termSnapshot = [
    `cwd: ${ts.cwd || '~'}`,
    ts.gitBranch    ? `branch: ${ts.gitBranch}` : '',
    ts.lastCommand  ? `last_command: ${ts.lastCommand}` : '',
    ts.exitCode !== null && ts.exitCode !== undefined ? `exit_code: ${ts.exitCode}` : '',
    mem.unresolvedError ? `unresolved_error: ${mem.unresolvedError}` : '',
    ts.outputTail?.length ? `output:\n${ts.outputTail.join('\n')}` : '',
  ].filter(Boolean).join('\n');

  const systemPrompt = [
    systemContract,
    workspaceMem ? `\n[Workspace]\n${workspaceMem}` : '',
    termSnapshot  ? `\n[Terminal]\n${termSnapshot}`  : '',
  ].filter(Boolean).join('\n');

  return {
    systemPrompt,
    messages: [
      ...(mem.recentTurns || []).slice(-10).map(t => ({ role: t.role, content: t.content })),
      { role: 'user', content: userMessage },
    ],
  };
}

export function recordTurn(session, userMessage, assistantReply, metrics = null) {
  const mem = session.memory;
  if (!mem) return;
  mem.recentTurns.push(
    { role: 'user',      content: userMessage,    tokens: estimateTokens(userMessage) },
    { role: 'assistant', content: assistantReply, tokens: estimateTokens(assistantReply) },
  );
  if (metrics) mem.metrics.push(metrics);
  if (!mem.activeObjective && userMessage.length > 20) {
    mem.activeObjective = userMessage.slice(0, 120);
  }
  compactIfNeeded(session);
  persistSession(session);
}

export function compactIfNeeded(session) {
  const mem = session.memory;
  if (!mem || mem.recentTurns.length < 4) return;
  const total = mem.recentTurns.reduce((s, t) => s + (t.tokens || 0), 0);
  if (total < SOFT_LIMIT) return;
  if (total >= HARD_LIMIT) {
    const all = mem.recentTurns.map(t => `${t.role}: ${t.content}`).join('\n');
    mem.sessionSummary = `[Compacted ${mem.recentTurns.length} turns] ${all.slice(0, 500)}`;
    mem.recentTurns = mem.recentTurns.slice(-4);
    mem.taskSummary = mem.activeObjective || '';
    return;
  }
  const dropped = mem.recentTurns.splice(0, 4);
  const summary = dropped.filter(t => t.role === 'user').map(t => t.content.slice(0, 80)).join(' → ');
  if (summary) {
    mem.sessionSummary = ((mem.sessionSummary ? mem.sessionSummary + ' | ' : '') + summary).slice(-400);
  }
}

export function shouldEscalate(session, localReply) {
  const mem = session.memory;
  if (!mem) return false;
  const total = mem.recentTurns.reduce((s, t) => s + (t.tokens || 0), 0);
  if (total > HARD_LIMIT) return true;
  if (/i('m| am) not sure|i don't know|cannot determine|unclear/i.test(localReply)) return true;
  return false;
}
