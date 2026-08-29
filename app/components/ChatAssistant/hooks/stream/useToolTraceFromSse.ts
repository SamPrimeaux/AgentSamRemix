/**
 * Tool trace SSE: tool_start / tool_output / tool_error → toolTrace rows.
 */
import {
  patchTraceRowCadJob,
  resolveCadJobIdFromSse,
} from '../../../../lib/cadToolTrace';
import { formatToolTraceInput } from '../../../../lib/formatToolTraceSummary';
import { isImageGenerationToolName } from '../../../../lib/toolTracePreview';
import { sanitizeBrowserNavigateUrl } from '../../../../lib/sanitizeBrowserUrl';
import { normalizeBrowserToolErrorMessage } from '../../streamParsing';
import { patchIamAgentStreamDebug } from '../../streamDebug';
import {
  isBrowserScreenshotToolName,
  isCdtBrowserToolName,
  parseBrowserToolAutomationFlag,
} from './sseHelpers';
import type { SseSession, SseDispatchResult } from './sseTypes';
import { resolveToolTraceRowId } from './sseHelpersToolParse';

/** Early evType===tool_error thinking ping (original order: before tool_blocked). */
export function handleToolErrorThinkingFromSse(
  s: SseSession,
  data: unknown,
  evType: string | undefined,
): SseDispatchResult {
if (evType === 'tool_error') {
  // Host emits `tool` historically; also accept tool_name. Fall through so
  // handleToolTraceFromSse can mark the running row failed (do not short-circuit).
  const d = data as { tool_name?: string; tool?: string; node_key?: string };
  const toolName = String(d.tool_name || d.tool || d.node_key || '');
  s.ctx.onThinkingEvent?.({ type: 'tool_error', tool_name: toolName });
  return 'fallthrough';
}
  return 'fallthrough';
}

/** tool_start / tool_error / tool_output → toolTrace. */
export function handleToolTraceFromSse(s: SseSession, data: unknown, evType: string | undefined): SseDispatchResult {
if (data && typeof data === 'object' && (data as { type?: string }).type === 'tool_start') {
  const d = data as {
    type: 'tool_start';
    tool_name?: string;
    node_key?: string;
    tool_call_id?: string;
    input_preview?: string | null;
  };
  const tn = String(d.tool_name || d.node_key || '');
  s.ctx.onThinkingEvent?.({ type: 'tool_start', tool_name: tn });
  patchIamAgentStreamDebug({ last_tool_name: tn || null });
  s.pendingBrowserToolUrl = null;
  s.pendingBrowserToolAutomation = false;
  s.lastBrowserToolOutputChunk = null;
  s.lastBrowserScreenshotOutputChunk = null;
  s.activeBrowserScreenshotTool = isBrowserScreenshotToolName(tn);
  s.activeBrowserNavTool =
    !s.activeBrowserScreenshotTool &&
    (tn === 'browser_open_url' || tn === 'cdt_navigate_page' || tn === 'browser_navigate');
  if (s.activeBrowserNavTool) {
    try {
      const inp = JSON.parse(String(d.input_preview || '{}')) as Record<string, unknown>;
      const u =
        (typeof inp.url === 'string' && inp.url.trim()) ||
        (typeof inp.href === 'string' && inp.href.trim()) ||
        (typeof inp.target_url === 'string' && inp.target_url.trim()) ||
        (typeof inp.page_url === 'string' && inp.page_url.trim()) ||
        '';
      if (u) s.pendingBrowserToolUrl = sanitizeBrowserNavigateUrl(u) || u;
      s.pendingBrowserToolAutomation =
        parseBrowserToolAutomationFlag(inp) || isCdtBrowserToolName(tn);
      if (typeof window !== 'undefined' && s.pendingBrowserToolUrl) {
        window.dispatchEvent(
          new CustomEvent('iam-browser-url-pending', {
            detail: { url: s.pendingBrowserToolUrl, tool_call_id: d.tool_call_id ?? null },
          }),
        );
      }
    } catch {
      /* ignore */
    }
  }
  // Browser tab opens only via SSE surface_open / agent_surface_open (not tool_start).
  // Keep activity ping so an already-open BrowserView can show live chrome.
  if (
    typeof window !== 'undefined' &&
    (tn.startsWith('cdt_') || tn.startsWith('browser_') || tn === 'playwright_screenshot')
  ) {
    window.dispatchEvent(
      new CustomEvent('iam:agent-browser-tool-active', {
        detail: { tool_name: tn, phase: 'start' },
      }),
    );
  }
  const toolCallId =
    typeof d.tool_call_id === 'string' && d.tool_call_id.trim() ? d.tool_call_id.trim() : null;
  const rowId = toolCallId || `sse-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  s.activeToolTraceId = rowId;
  s.lastActiveToolOutputChunk = null;
  const isSql =
    !!d.tool_name &&
    (d.tool_name.includes('d1') || d.tool_name.includes('sql') || d.tool_name.includes('query'));
  const preview = d.input_preview != null ? String(d.input_preview) : '';
  const { summaryLines, detailsJson } = formatToolTraceInput(tn, preview);
  const startIntegrationLabel =
    /terminal|mcp/i.test(tn) && tn.includes('mcp')
      ? 'inneranimalmedia-mcp-server'
      : /terminal/.test(tn)
        ? 'Agent Sam'
        : undefined;
  s.ctx.setMessages((prev) => s.upsertAssistantTail(prev, { content: s.assistantContent, executionPlan: s.executionPlan}));
  s.ctx.setToolTraceRows?.((prev) => [
    ...prev,
    {
      id: rowId,
      toolCallId: toolCallId || rowId,
      toolName: d.tool_name || 'tool',
      status: 'running',
      lines: summaryLines,
      detailsJson,
      integrationLabel: startIntegrationLabel,
      startedAtLabel: new Date().toLocaleTimeString(),
      isSql,
    },
  ]);
  if (tn) {
    s.ctx.setWorkflowLedger((prev) => (prev.runId ? { ...prev, currentNodeKey: tn } : prev));
  }
  return 'continue';
}
if (data && typeof data === 'object' && (data as { type?: string }).type === 'tool_error') {
  const d = data as { type?: string; tool?: string; tool_call_id?: string; error?: string };
  const rawMsg = String(d.error || 'tool_error').slice(0, 4000);
  const toolLabel = String(d.tool || 'tool');
  const normalized = normalizeBrowserToolErrorMessage(toolLabel, rawMsg);
  let closedRowId: string | null = null;
  s.ctx.setToolTraceRows?.((prev) => {
    closedRowId = resolveToolTraceRowId(prev, d.tool_call_id, s.activeToolTraceId, toolLabel);
    const traceLine = `${normalized.short}${normalized.detail !== rawMsg ? `\n${normalized.detail}` : ''}`;
    if (closedRowId && prev.some((r) => r.id === closedRowId)) {
      return prev.map((r) =>
        r.id === closedRowId
          ? {
              ...r,
              status: 'error' as const,
              lines: [...r.lines, `[${toolLabel}] ${traceLine}`],
            }
          : r,
      );
    }
    const id = d.tool_call_id?.trim() || `sse-tool-err-${Date.now()}`;
    return [
      ...prev,
      {
        id,
        toolCallId: id,
        toolName: toolLabel,
        status: 'error',
        lines: [traceLine],
        startedAtLabel: new Date().toLocaleTimeString(),
      },
    ];
  });
  if (closedRowId && s.activeToolTraceId === closedRowId) s.activeToolTraceId = null;
  s.ctx.onThinkingEvent?.({ type: 'tool_error', tool_name: toolLabel });
  s.ctx.setMessages((prev) => {
    const next = [...prev];
    const idx = next.length - 1;
    if (idx < 0 || next[idx].role !== 'assistant') return prev;
    const ig = next[idx].imageGenerationState;
    if (!ig || ig.phase === 'completed') return prev;
    // Sibling imgx timeout / shared-budget drain must not wipe a live preview or URL.
    const hasVisual =
      Boolean(ig.imageUrl || ig.previewUrl || ig.committedUrl) ||
      Boolean(ig.previewFrames?.length);
    const errText = String(d.error || '').toLowerCase();
    const isTimeout = /timed?\s*out|timeout|deadline/i.test(errText);
    if (hasVisual || (isTimeout && isImageGenerationToolName(toolLabel))) {
      return prev;
    }
    next[idx] = {
      ...next[idx],
      imageGenerationState: {
        ...ig,
        phase: 'failed',
        failed: true,
        progress: ig.progress,
        message: 'Image generation failed',
      },
    };
    return next;
  });
  s.activeToolTraceId = null;
  s.pendingBrowserToolUrl = null;
  s.pendingBrowserToolAutomation = false;
  s.lastBrowserToolOutputChunk = null;
  s.lastBrowserScreenshotOutputChunk = null;
  s.activeBrowserNavTool = false;
  s.activeBrowserScreenshotTool = false;
  return 'continue';
}
if (
  data &&
  typeof data === 'object' &&
  (data as { type?: string }).type === 'tool_output' &&
  typeof (data as { chunk?: unknown }).chunk === 'string'
) {
  const d = data as { type: 'tool_output'; chunk: string };
  if (s.activeBrowserNavTool) {
    s.lastBrowserToolOutputChunk = d.chunk;
  }
  if (s.activeBrowserScreenshotTool) {
    s.lastBrowserScreenshotOutputChunk = d.chunk;
  }
  s.lastActiveToolOutputChunk = d.chunk;
  const chunkToolName =
    typeof (d as { tool_name?: string }).tool_name === 'string'
      ? (d as { tool_name: string }).tool_name
      : '';
  const chunkJobId = chunkToolName
    ? resolveCadJobIdFromSse(chunkToolName, { chunk: d.chunk })
    : null;
  s.ctx.setToolTraceRows?.((prev) => {
    const patchRow = (r: AgentToolTraceRow) => {
      if (!chunkToolName) return r;
      if (r.id !== s.activeToolTraceId && r.toolName !== chunkToolName) return r;
      return patchTraceRowCadJob(r, chunkToolName, {
        jobId: chunkJobId,
        outputPreview: d.chunk,
      });
    };
    if (s.activeToolTraceId) {
      return prev.map((r) =>
        r.id === s.activeToolTraceId
          ? { ...patchRow(r), lines: [...r.lines, d.chunk] }
          : r,
      );
    }
    if (!prev.length) return prev;
    const last = prev[prev.length - 1];
    if (last.status === 'running') {
      return prev.map((r, i) =>
        i === prev.length - 1 ? { ...patchRow(r), lines: [...r.lines, d.chunk] } : r,
      );
    }
    return prev;
  });
}
  return 'fallthrough';
}
