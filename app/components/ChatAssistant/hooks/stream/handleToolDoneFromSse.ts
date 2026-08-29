/**
 * tool_done SSE → close toolTrace rows + imgx/veo/browser side effects.
 */
import { IAM_DESIGNSTUDIO_CAD_JOB } from '../../../../agentChatConstants';
import {
  patchTraceRowCadJob,
  resolveCadJobIdFromSse,
  cadJobOutputLooksInFlight,
} from '../../../../lib/cadToolTrace';
import {
  formatToolTraceOutput,
  parseToolTraceReceiptMeta,
} from '../../../../lib/formatToolTraceSummary';
import { isImageGenerationToolName, isVideoGenerationToolName } from '../../../../lib/toolTracePreview';
import {
  agentFilesFromImageSse,
  appendAgentFilesToAssistantTail,
  parseVeoToolPayload,
  patchAssistantImageGeneration,
  patchAssistantVideoGeneration,
} from './sseHelpersMedia';
import {
  isBrowserScreenshotToolName,
  parseImgxToolPayload,
} from './sseHelpers';
import {
  parseScreenshotUrlFromToolPayload,
  resolveToolTraceRowId,
} from './sseHelpersToolParse';
import type { SseSession, SseDispatchResult } from './sseTypes';

export function handleToolDoneFromSse(s: SseSession, data: unknown, evType: string | undefined): SseDispatchResult {
if (data && typeof data === 'object' && (data as { type?: string }).type === 'tool_done') {
  const d = data as {
    type: 'tool_done';
    tool_name?: string;
    node_key?: string;
    tool_call_id?: string;
    status?: string;
    ok?: boolean;
    // Backend s.ctx.signal (currently emitted by openai_hosted_shell empty/workspace-scope
    // auto-recover path — see agent-sse-consumer.js): this ok:false was an internal
    // retry, not a terminal failure. Renders as the in-progress/loading state instead
    // of the hard error icon.
    recoverable?: boolean;
    output_preview?: string;
    duration_ms?: number;
    rows?: Record<string, unknown>[] | null;
    error?: string;
    artifact_type?: string;
    artifact_id?: string;
    public_url?: string | null;
    job_id?: string;
    cad_job_id?: string;
    cad_job_live?: boolean;
  };
  const doneToolName = String(d.tool_name || d.node_key || '');
  const doneOk =
    d.status != null ? d.status !== 'error' : d.ok !== false;
  const outputPreview =
    typeof d.output_preview === 'string'
      ? d.output_preview
      : s.lastActiveToolOutputChunk ||
        s.lastBrowserToolOutputChunk ||
        s.lastBrowserScreenshotOutputChunk;
  const receiptMeta = parseToolTraceReceiptMeta(doneToolName, outputPreview);
  const integrationLabel =
    /terminal|mcp/i.test(doneToolName) && doneToolName.includes('mcp')
      ? 'inneranimalmedia-mcp-server'
      : /terminal/.test(doneToolName)
        ? 'Agent Sam'
        : undefined;
  const { summaryLines, detailsJson: outputDetailsJson } = formatToolTraceOutput(
    doneToolName,
    outputPreview,
  );
  let parsedSqlRows = d.rows ?? undefined;
  if (!parsedSqlRows && outputPreview) {
    try {
      const parsedOut = JSON.parse(outputPreview) as { rows?: Record<string, unknown>[] };
      if (Array.isArray(parsedOut?.rows)) parsedSqlRows = parsedOut.rows;
    } catch {
      /* ignore */
    }
  }
  let smokeDebug: Record<string, unknown> | null = null;
  try {
    const parsed = outputPreview ? JSON.parse(outputPreview) : null;
    if (parsed && typeof parsed === 'object' && parsed.smoke_debug) {
      smokeDebug = parsed.smoke_debug as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  s.ctx.onThinkingEvent?.({
    type: 'tool_done',
    tool_name: doneToolName,
    ok: doneOk,
    output_preview:
      summaryLines.join(' · ') ||
      (d.error ? String(d.error).slice(0, 120) : undefined),
  });
  const rawToolOutput =
    typeof d.output_preview === 'string'
      ? d.output_preview
      : outputPreview || s.lastActiveToolOutputChunk;
  const cadJobId = resolveCadJobIdFromSse(doneToolName, {
    job_id: d.job_id,
    cad_job_id: d.cad_job_id,
    output_preview: rawToolOutput,
    chunk: s.lastActiveToolOutputChunk,
  });
  const cadJobLive =
    d.cad_job_live === true ||
    (cadJobId != null && cadJobOutputLooksInFlight(doneToolName, rawToolOutput));
  if (doneOk && typeof window !== 'undefined') {
    if (cadJobId) {
      window.dispatchEvent(
        new CustomEvent(IAM_DESIGNSTUDIO_CAD_JOB, { detail: { job_id: cadJobId } }),
      );
    }
  }
  if (
    d.status !== 'error' &&
    d.tool_name === 'excalidraw_plan_map_create' &&
    d.artifact_type === 'excalidraw' &&
    typeof d.artifact_id === 'string' &&
    d.artifact_id.trim()
  ) {
    const loadUrl =
      typeof d.public_url === 'string' && d.public_url.trim()
        ? d.public_url.trim()
        : `/api/artifacts/${encodeURIComponent(d.artifact_id.trim())}/content`;
    window.dispatchEvent(
      new CustomEvent('iam:agent-open-surface', {
        detail: {
          surface: 'excalidraw',
          reason: 'excalidraw_plan_map_tool_done',
          load_url: loadUrl,
          artifact_id: d.artifact_id.trim(),
          artifact_type: 'excalidraw',
        },
      }),
    );
  }
  if (
    doneOk &&
    (doneToolName === 'browser_open_url' ||
      doneToolName === 'cdt_navigate_page' ||
      doneToolName === 'browser_navigate')
  ) {
    /* BrowserView URL updates from browser_url_committed (verified), not optimistic tool_done. */
    s.pendingBrowserToolUrl = null;
    s.pendingBrowserToolAutomation = false;
    s.lastBrowserToolOutputChunk = null;
    s.activeBrowserNavTool = false;
  } else if (
    doneToolName === 'browser_open_url' ||
    doneToolName === 'cdt_navigate_page' ||
    doneToolName === 'browser_navigate'
  ) {
    s.pendingBrowserToolUrl = null;
    s.pendingBrowserToolAutomation = false;
    s.lastBrowserToolOutputChunk = null;
    s.activeBrowserNavTool = false;
  }
  if (doneOk && isBrowserScreenshotToolName(doneToolName)) {
    const shotUrl =
      parseScreenshotUrlFromToolPayload(
        typeof d.output_preview === 'string' ? d.output_preview : null,
      ) ||
      parseScreenshotUrlFromToolPayload(s.lastBrowserScreenshotOutputChunk) ||
      (typeof d.public_url === 'string' && /^https?:/i.test(d.public_url.trim())
        ? d.public_url.trim()
        : null);
    if (shotUrl && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('iam-browser-screenshot', {
          detail: { screenshot_url: shotUrl, tool_name: doneToolName },
        }),
      );
    }
    s.lastBrowserScreenshotOutputChunk = null;
    s.activeBrowserScreenshotTool = false;
  } else if (isBrowserScreenshotToolName(doneToolName)) {
    s.lastBrowserScreenshotOutputChunk = null;
    s.activeBrowserScreenshotTool = false;
  }
  // Belt-and-suspenders: if SSE image_generation_* was missed (cancel/race),
  // still stand up the card from the tool result URL.
  if (doneOk && isImageGenerationToolName(doneToolName)) {
    const rawOut =
      typeof d.output_preview === 'string' ? d.output_preview : outputPreview;
    const imgx = parseImgxToolPayload(rawOut);
    const publicUrl =
      typeof d.public_url === 'string' && d.public_url.trim() ? d.public_url.trim() : null;
    const imageUrl = imgx.imageUrl || publicUrl;
    if (imageUrl) {
      patchAssistantImageGeneration(
        s.ctx.setMessages,
        s.assistantContent,
        {
          generationId: imgx.generationId || `igen_tool_${Date.now()}`,
          phase: 'completed',
          progress: 100,
          message: 'Image ready',
          imageUrl,
          previewUrl: imageUrl,
          status: imgx.status === 'saved' || imgx.status === 'draft' ? (imgx.status as 'saved' | 'draft') : 'saved',
          failed: false,
        },
        'image_generation_complete',
      );
    }
    try {
      const parsed = rawOut?.trim() ? (JSON.parse(rawOut) as unknown) : null;
      if (parsed && typeof parsed === 'object') {
        appendAgentFilesToAssistantTail(s.ctx.setMessages, agentFilesFromImageSse(parsed));
      } else if (imageUrl) {
        appendAgentFilesToAssistantTail(
          s.ctx.setMessages,
          agentFilesFromImageSse({
            image_url: imageUrl,
            generation_id: imgx.generationId,
          }),
        );
      }
    } catch {
      if (imageUrl) {
        appendAgentFilesToAssistantTail(
          s.ctx.setMessages,
          agentFilesFromImageSse({
            image_url: imageUrl,
            generation_id: imgx.generationId,
          }),
        );
      }
    }
  }
  if (doneOk && isVideoGenerationToolName(doneToolName)) {
    const rawOut =
      typeof d.output_preview === 'string' ? d.output_preview : outputPreview;
    const veo = parseVeoToolPayload(rawOut);
    const jobId =
      veo.jobId ||
      (typeof d.job_id === 'string' ? d.job_id.trim() : null) ||
      null;
    if (jobId) {
      patchAssistantVideoGeneration(s.ctx.setMessages, {
        jobId,
        phase: 'queued',
        progress: 15,
        message: 'Video queued…',
        destination: veo.destination,
        model: veo.model || undefined,
        status: 'draft',
        failed: false,
      });
    }
  }
  let closedRowId: string | null = null;
  s.ctx.setToolTraceRows?.((prev) => {
    closedRowId = resolveToolTraceRowId(
      prev,
      d.tool_call_id,
      s.activeToolTraceId,
      doneToolName,
    );
    if (!closedRowId || !prev.some((r) => r.id === closedRowId)) return prev;
    return prev.map((r) =>
      r.id === closedRowId
        ? patchTraceRowCadJob(
            {
              ...r,
              // A recoverable failure (currently: hosted-shell empty/workspace-scope
              // auto-retry — see agent-sse-consumer.js) renders as 'running' (the same
              // in-progress/loading UI as an active tool call) instead of 'error', since
              // the agent loop retries it automatically and it isn't a terminal failure
              // the user needs to see flagged red.
              status:
                (d.status === 'error' || !doneOk) && !d.recoverable
                  ? 'error'
                  : d.recoverable || cadJobLive
                    ? 'running'
                    : 'done',
              durationMs: d.duration_ms,
              sqlRows: parsedSqlRows ?? undefined,
              isSql:
                r.isSql ||
                /d1|sql|query/i.test(doneToolName),
              integrationLabel: integrationLabel ?? r.integrationLabel,
              connectionResolution:
                receiptMeta?.connectionResolution ?? r.connectionResolution,
              connectionId: receiptMeta?.connectionId ?? r.connectionId,
              execHost: receiptMeta?.execHost ?? r.execHost,
              lines:
                d.status === 'error' && d.error
                  ? [...summaryLines, String(d.error).slice(0, 4000)]
                  : summaryLines.length
                    ? summaryLines
                    : r.lines,
              detailsJson: r.detailsJson,
              outputDetailsJson: outputDetailsJson ?? r.outputDetailsJson,
              smokeDebug: smokeDebug ?? r.smokeDebug,
            },
            doneToolName,
            {
              jobId: cadJobId,
              outputPreview: rawToolOutput,
              cadJobLive: cadJobLive,
            },
          )
        : r,
    );
  });
  if (closedRowId && s.activeToolTraceId === closedRowId) s.activeToolTraceId = null;
  s.lastActiveToolOutputChunk = null;
}
  return 'fallthrough';
}
