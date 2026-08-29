/**
 * Terminal slash command router — shell-only by default; opt-in AI via /agentsam.
 */
import { dispatchComplete } from '../runtime/provider-dispatch.js';
import { resolveModelForTask } from '../runtime/routing/resolve-model-for-task.js';
import { normalizeCanonicalTaskType } from '../runtime/routing/resolve-model-task-types.js';
import {
  DEFAULT_TERMINAL_PREFS,
  loadTerminalSessionPrefs,
  saveTerminalSessionPrefs,
  userCanUseTerminalAi,
  loadTerminalAgentCatalog,
  loadTerminalModelCatalog,
} from '../../../src/core/terminal-assist-prefs.js';

function termLine(text) {
  return `\r\n\x1b[1;36m  › ${text}\x1b[0m\r\n`;
}

function termErr(text) {
  return `\r\n\x1b[1;31m  ✗ ${text}\x1b[0m\r\n`;
}

function parseSlashLine(line) {
  const raw = String(line || '').trim();
  if (!raw.startsWith('/')) return { cmd: '', args: [] };
  const parts = raw.slice(1).split(/\s+/).filter(Boolean);
  return { cmd: (parts[0] || '').toLowerCase(), args: parts.slice(1) };
}

/**
 * @param {Record<string, unknown>} env
 * @param {{
 *   line: string,
 *   userId: string,
 *   workspaceId: string,
 *   tenantId?: string | null,
 *   sessionId: string,
 *   broadcast: (text: string) => void,
 * }} ctx
 */
export async function handleTerminalSlashCommand(env, ctx) {
  const { line, userId, workspaceId, tenantId, sessionId, broadcast } = ctx;
  const { cmd, args } = parseSlashLine(line);
  if (!cmd) {
    broadcast(termErr('Empty slash command'));
    return;
  }

  const prefs = await loadTerminalSessionPrefs(env, sessionId);
  const aiAllowed = await userCanUseTerminalAi(env, userId, workspaceId);

  if (cmd === 'help') {
    broadcast(
      termLine('Terminal slash commands (not sent to shell):') +
        termLine('/help — this message') +
        termLine('/agentsam — enable Agent Sam (requires policy)') +
        termLine('/agentsam off — return to shell-only mode') +
        termLine('/agentsam list — list available agents') +
        termLine('/agentsam use <slug> — select agent profile') +
        termLine('/models — list picker-eligible models') +
        termLine('/models use <model_key> — select model') +
        termLine('/ask <question> — AI assist (opt-in; P2 stub if disabled)'),
    );
    return;
  }

  if (cmd === 'agentsam') {
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'off') {
      const next = {
        ...prefs,
        terminal_mode: 'shell',
        terminal_ai_enabled: false,
      };
      await saveTerminalSessionPrefs(env, sessionId, next, userId, workspaceId);
      broadcast(termLine('Agent Sam disabled — shell-only mode.'));
      return;
    }
    if (sub === 'list') {
      const agents = await loadTerminalAgentCatalog(env, { userId, workspaceId, tenantId });
      if (!agents.length) {
        broadcast(termLine('No active agent profiles found.'));
        return;
      }
      broadcast(termLine('Available agents:'));
      for (const a of agents) {
        broadcast(termLine(`  ${a.slug} — ${a.display_name || a.slug}`));
      }
      return;
    }
    if (sub === 'use') {
      const slug = args[1];
      if (!slug) {
        broadcast(termErr('Usage: /agentsam use <slug>'));
        return;
      }
      if (!aiAllowed) {
        broadcast(termErr('Terminal AI is not enabled for your account (agentsam_user_policy.terminal_ai_enabled).'));
        return;
      }
      const agents = await loadTerminalAgentCatalog(env, { userId, workspaceId, tenantId });
      const match = agents.find((a) => a.slug === slug);
      if (!match) {
        broadcast(termErr(`Unknown agent slug: ${slug}`));
        return;
      }
      const next = {
        ...prefs,
        terminal_mode: 'agentsam',
        terminal_ai_enabled: true,
        active_agent_slug: slug,
        active_model_key: prefs.active_model_key || match.default_model_id || null,
      };
      await saveTerminalSessionPrefs(env, sessionId, next, userId, workspaceId);
      broadcast(termLine(`Agent Sam enabled — profile: ${slug}`));
      if (next.active_model_key) {
        broadcast(termLine(`Model: ${next.active_model_key}`));
      }
      return;
    }
    if (!aiAllowed) {
      broadcast(termErr('Terminal AI is not enabled for your account (agentsam_user_policy.terminal_ai_enabled).'));
      return;
    }
    const next = {
      ...prefs,
      terminal_mode: 'agentsam',
      terminal_ai_enabled: true,
    };
    await saveTerminalSessionPrefs(env, sessionId, next, userId, workspaceId);
    broadcast(termLine('Agent Sam enabled for this terminal session (opt-in).'));
    broadcast(termLine('Use /agentsam list and /agentsam use <slug> to pick a profile.'));
    return;
  }

  if (cmd === 'models') {
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'use') {
      const modelKey = args[1];
      if (!modelKey) {
        broadcast(termErr('Usage: /models use <model_key>'));
        return;
      }
      if (!aiAllowed) {
        broadcast(termErr('Terminal AI is not enabled for your account.'));
        return;
      }
      const models = await loadTerminalModelCatalog(env, { userId, workspaceId });
      const match = models.find((m) => m.model_key === modelKey);
      if (!match) {
        broadcast(termErr(`Model not available: ${modelKey}`));
        return;
      }
      const next = { ...prefs, active_model_key: modelKey };
      await saveTerminalSessionPrefs(env, sessionId, next, userId, workspaceId);
      broadcast(termLine(`Active model: ${modelKey} (${match.display_name || modelKey})`));
      return;
    }
    const models = await loadTerminalModelCatalog(env, { userId, workspaceId });
    if (!models.length) {
      broadcast(termLine('No picker-eligible models found.'));
      return;
    }
    broadcast(termLine('Available models:'));
    for (const m of models.slice(0, 40)) {
      const tag = m.is_degraded ? ' [degraded]' : '';
      broadcast(termLine(`  ${m.model_key} — ${m.display_name || m.model_key}${tag}`));
    }
    return;
  }

  if (cmd === 'ask') {
    if (!aiAllowed) {
      broadcast(termErr('Terminal AI is not enabled for your account.'));
      return;
    }
    if (!prefs.terminal_ai_enabled) {
      broadcast(termErr('Run /agentsam first to opt in to terminal AI for this session.'));
      return;
    }
    const question = args.join(' ').trim();
    if (!question) {
      broadcast(termErr('Usage: /ask <your question>'));
      return;
    }
    const modelKey = prefs.active_model_key;
    if (!modelKey) {
      broadcast(termErr('No active model — use /models or /models use <model_key>.'));
      return;
    }
    try {
      const resolved = await resolveModelForTask(env, {
        task_type: normalizeCanonicalTaskType('terminal_execution'),
        requested_model_key: modelKey,
        workspace_id: workspaceId,
        tenant_id: tenantId || undefined,
      });
      const result = await dispatchComplete(env, {
        modelKey: resolved.model_key,
        systemPrompt:
          'You are a developer assistant embedded in the IAM terminal. Be concise. Plain text only. Max 10 lines unless essential.',
        messages: [{ role: 'user', content: question }],
        options: { reasoningEffort: 'none', verbosity: 'low' },
      });
      const text =
        result?.content?.[0]?.text ||
        result?.choices?.[0]?.message?.content ||
        result?.text ||
        result?.output_text ||
        (typeof result === 'string' ? result : JSON.stringify(result));
      broadcast(termLine(String(text).slice(0, 1200)));
    } catch (e) {
      broadcast(termErr(`Assist failed: ${e?.message || String(e)}`));
    }
    return;
  }

  broadcast(termErr(`Unknown slash command: /${cmd}. Try /help`));
}

export { DEFAULT_TERMINAL_PREFS, parseSlashLine };
