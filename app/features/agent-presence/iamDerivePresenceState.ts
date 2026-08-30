// app/features/agent-presence/iamDerivePresenceState.ts

import type { AgentPresenceState } from './iamPresenceStateMap';

function browserLiveTool(signal: string): boolean {
  return /live_view|browser_session|browser_scroll|browser_navigate|cdt_navigate|cdt_click|cdt_fill|cdt_wait|cdt_evaluate|playwright/.test(
    signal,
  );
}

function browserDebugTool(signal: string): boolean {
  return /browser_verify|verify_current_page|browser_content|cdt_take_snapshot|console|network|a11y/.test(
    signal,
  );
}

function classifyToolSignal(signal: string): AgentPresenceState | null {
  if (/tavily|search_web|open_web_search|web_search/.test(signal)) return 'browser';
  if (/web_fetch|fetch_url|read_url|markdown/.test(signal)) return 'browser';
  if (/human_input|hitl|browser_human_input/.test(signal)) return 'waiting_approval';
  if (/screenshot|capture_full_page|capture_selected|quality_report/.test(signal)) return 'browser_capture';
  if (browserDebugTool(signal)) return 'browser_debug';
  if (browserLiveTool(signal)) return 'browser_live';
  if (/browser|playwright|cdt|navigate|click|highlight|dom|css/.test(signal)) return 'browser';
  if (/terminal|shell|bash|run|exec|command|wrangler|npm|node|python|build|deploy/.test(signal))
    return 'terminal';
  if (/d1|sql|supabase|postgres|database|query|table|schema|migration/.test(signal)) return 'database';
  if (/image|thumbnail|media|asset.preview|visual.asset|generate.image/.test(signal)) return 'imaging';
  if (/excalidraw|diagram|draw|canvas|flowchart|wireframe/.test(signal)) return 'drawing';
  if (/r2|bucket|upload|download|artifact|asset|storage|file.browser/.test(signal)) return 'files';
  if (/monaco|write|create|save|edit|patch|diff|replace|commit/.test(signal)) return 'writing';
  if (/read|fetch|get|inspect|load|open|grep|search|list|scan/.test(signal)) return 'reading';
  return null;
}

export function derivePresenceState(event: Record<string, unknown>): AgentPresenceState {
  const type = String(event?.type || '').toLowerCase();
  const handler = String(event?.handler_type || event?.handler || '').toLowerCase();
  const tool = String(event?.tool_name || event?.name || event?.tool || '').toLowerCase();
  const title = String(event?.title || event?.task_title || event?.message || '').toLowerCase();

  const signal = `${handler} ${tool} ${title}`;

  if (!type) return 'idle';

  if (type === 'browser_verification_failed') return 'failed';
  if (type === 'browser_human_input_required') return 'waiting_approval';
  if (type === 'browser_session_starting') return 'browser_live';
  if (type === 'browser_live_view_ready' || type === 'browser_session_ready') return 'browser_live';
  if (type === 'browser_action_started') {
    return browserDebugTool(signal) ? 'browser_debug' : 'browser_live';
  }
  if (type === 'browser_capture' || type.includes('screenshot')) return 'browser_capture';

  if (type === 'thinking_start' || type === 'thinking') return 'thinking';
  if (type === 'plan_thinking') return 'mapping';
  if (type === 'plan_created') return 'handoff_ready';
  if (type === 'plan_progress') return 'task_stack';
  if (type === 'approval_required' || type === 'plan_confirmation_required') return 'waiting_approval';
  if (type === 'plan_complete' || type === 'done' || type === 'complete') return 'complete';
  if (type === 'error' || type === 'tool_error' || type === 'failed') return 'failed';

  if (type === 'task_start') {
    const classified = classifyToolSignal(signal);
    if (classified) return classified;
    if (/mcp_tool|tool/.test(signal)) return 'tool';
    return 'thinking';
  }

  if (type === 'tool_start') {
    const classified = classifyToolSignal(signal);
    if (classified) return classified;
    return 'tool';
  }

  if (type === 'tool_delta' || type === 'task_delta' || type === 'progress') {
    return (event?.previousPresenceState as AgentPresenceState) || 'thinking';
  }

  return 'thinking';
}
