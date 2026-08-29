import { Think } from '@cloudflare/think';
import { createExecuteRuntime, type ExecuteRuntime } from '@cloudflare/think/tools/execute';
import { BrowserConnector } from 'agents/browser';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { Env } from '../../src/env';
import {
  executeTerminalLane,
  scopeFromAgentName,
  terminalRuntimeStatus,
} from '../terminal/runtime';

export class AgentSam extends Think<Env> {
  private _domainTools?: ToolSet;
  private _executeRuntime?: ExecuteRuntime;

  getAIBinding() {
    return this.env.AGENTSAM_WAI;
  }

  getModel() {
    return this.env.AGENTSAM_MODEL || '@cf/moonshotai/kimi-k2.7-code';
  }

  getSystemPrompt() {
    return `You are Agent Sam inside AgentSamRemix, a compact Cloudflare-native engineering workbench.

Operate like a capable software engineering agent, not a chat-only assistant. Inspect before editing, keep changes focused, run relevant checks, and report concrete results.

Execution is explicit and fail-loud. There are three real terminal lanes and you must choose the lane that matches the user's intent:
- local: the user's registered Mac/workstation through ExecOS. Use this for the user's actual local checkout or machine-specific work.
- remote: the registered always-on platform VM through ExecOS. Use this when work should continue independently of the local machine.
- sandbox: an isolated Cloudflare Linux environment. Use this for package installs, disposable builds, risky experiments, unfamiliar repositories, dev servers, and verification that should not touch the user's machines.

Never silently substitute one lane for another. If a requested lane is unavailable, report that exact failure. terminal_status tells you which registered lanes are currently usable. terminal_exec performs the work against the D1-authorized target for the current user and workspace.

Your durable Think workspace is separate from those terminal targets and is appropriate for scratch notes and artifacts. The unified execute tool gives you Code Mode. Prefer Code Mode for multi-step filesystem/tool/browser composition so intermediate data stays inside the execution sandbox.

Browser access is a reusable Cloudflare Browser Run session owned durably by this Agent. On every newly loaded page, check whether WebMCP APIs are available (navigator.modelContext or navigator.modelContextTesting). Prefer structured WebMCP tools when available, re-list tools after state-changing actions, and fall back to CDP/DOM interaction only when needed.

Never claim a command, test, browser action, edit, deploy, or commit succeeded unless its tool result confirms it.`;
  }

  private runtimeScope = async () => {
    const scope = await scopeFromAgentName(this.env, this.name);
    if (!scope) throw new Error('agent_runtime_scope_unresolved');
    return scope;
  };

  private domainTools(): ToolSet {
    if (this._domainTools) return this._domainTools;

    const terminalStatus = tool({
      description: 'Return the registered Local, VM, and Sandbox execution lanes for this user/workspace without waking the sandbox container.',
      inputSchema: z.object({}),
      execute: async () => {
        const scope = await this.runtimeScope();
        return terminalRuntimeStatus(this.env, scope);
      },
    });

    const terminalExec = tool({
      description: 'Execute a command on one explicit Agent Sam execution lane. local=registered user machine, remote=always-on platform VM, sandbox=isolated Cloudflare Linux. Never changes lanes on failure.',
      inputSchema: z.object({
        lane: z.enum(['local', 'remote', 'sandbox']),
        command: z.string().min(1).max(24_000),
        cwd: z.string().min(1).max(2048).optional(),
        connectionId: z.string().min(1).max(256).optional(),
      }),
      execute: async ({ lane, command, cwd, connectionId }) => {
        const scope = await this.runtimeScope();
        return executeTerminalLane(this.env, {
          ...scope,
          lane,
          command,
          cwd,
          connectionId,
        });
      },
    });

    this._domainTools = {
      terminal_status: terminalStatus,
      terminal_exec: terminalExec,
    };
    return this._domainTools;
  }

  private executeRuntime(): ExecuteRuntime {
    if (this._executeRuntime) return this._executeRuntime;
    const tools = this.domainTools();
    this._executeRuntime = createExecuteRuntime(this, {
      tools,
      browser: this.env.MYBROWSER as any,
      session: {
        mode: 'reuse',
        key: this.name,
        keepAliveMs: 10 * 60 * 1000,
      },
      loader: this.env.LOADER,
      timeout: 45_000,
      globalOutbound: null,
    });
    return this._executeRuntime;
  }

  private browserConnector(): BrowserConnector | null {
    const connector = this.executeRuntime().connectors.find((candidate) => candidate instanceof BrowserConnector);
    return connector instanceof BrowserConnector ? connector : null;
  }

  getTools(): ToolSet {
    return {
      ...this.domainTools(),
      execute: this.executeRuntime().tool,
    };
  }

  /** Internal Durable Object RPC used by the authenticated editor route. */
  async getBrowserLiveView() {
    const browser = this.browserConnector();
    if (!browser) return { ok: false, active: false, error: 'browser_connector_unavailable' };
    const [session, liveView] = await Promise.all([
      browser.sessionInfo(),
      browser.liveView({ mode: 'tab' }),
    ]);
    if (!session || !liveView) return { ok: true, active: false };
    return {
      ok: true,
      active: true,
      sessionId: liveView.sessionId,
      expiresInMs: liveView.expiresInMs,
      targets: liveView.targets,
    };
  }

  /** Internal Durable Object RPC used by the authenticated editor route. */
  async closeBrowserLiveView() {
    const browser = this.browserConnector();
    if (!browser) return { ok: true, closed: false };
    await browser.closeSession();
    return { ok: true, closed: true };
  }
}
