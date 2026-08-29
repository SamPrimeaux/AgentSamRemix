/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageGenerationPhase, ImageGenerationPreviewFrame, ImageGenerationState } from './types';

export const IMAGE_GENERATION_SSE_TYPES = new Set([
  'image_generation_started',
  'image_generation_progress',
  'image_generation_preview',
  'image_generation_complete',
]);

/** Block chat UI leaks that look like OpenAI streaming chunks (never append). */
export function looksLikeRawProviderLeak(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const o = data as Record<string, unknown>;
  const looksOpenAiFraming =
    o.object === 'chat.completion.chunk' ||
    (typeof o.id === 'string' && o.id.startsWith('chatcmpl'));
  if (!looksOpenAiFraming) return false;
  const choices = o.choices as Array<{ delta?: { content?: unknown } }> | undefined;
  const dc = choices?.[0]?.delta?.content;
  if (typeof dc === 'string' && dc.length > 0) return false;
  return true;
}

export function ssePayloadLooksReasoningOnly(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const o = data as Record<string, unknown>;
  const choices = o.choices as Array<{ delta?: Record<string, unknown> }> | undefined;
  const d = choices?.[0]?.delta;
  if (!d || typeof d !== 'object') return false;
  const c = d.content;
  const hasContent = typeof c === 'string' && c.length > 0;
  if (hasContent) return false;
  return !!(d.reasoning_content ?? d.reasoning ?? d.thinking ?? d.logprobs ?? d.token_ids ?? d.prompt_token_ids);
}

/**
 * Visible assistant text only — never reasoning_content / thinking / logprobs / raw SSE lines.
 */
export function normalizeAssistantSseText(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') return '';
  const p = parsed as Record<string, unknown>;
  const pt = p.type;
  if (
    pt === 'done' ||
    pt === 'error' ||
    pt === 'tool_approval_request' ||
    pt === 'approval_required' ||
    (typeof pt === 'string' && IMAGE_GENERATION_SSE_TYPES.has(pt))
  ) {
    return '';
  }

  const SSE_TEXT_TYPES = new Set(['text', 'token', 'delta', 'content', 'content_block_delta']);
  if (typeof pt === 'string' && pt && !SSE_TEXT_TYPES.has(pt) && !p.choices && !p.candidates) {
    return '';
  }

  const direct =
    (typeof p.text === 'string' ? p.text : '') ||
    (pt === 'token' && typeof p.text === 'string' ? p.text : '') ||
    (pt === 'delta' && typeof p.text === 'string' ? p.text : '') ||
    (pt === 'text' && typeof p.text === 'string' ? p.text : '');
  if (direct) return direct;

  const nestedDelta = p.delta as Record<string, unknown> | undefined;
  if (nestedDelta && typeof nestedDelta.content === 'string' && nestedDelta.content.length > 0) {
    return nestedDelta.content;
  }
  if (nestedDelta?.reasoning_content) {
    return '';
  }

  const choices = p.choices as Array<{ delta?: { content?: string } }> | undefined;
  const oc = choices?.[0]?.delta?.content;
  if (typeof oc === 'string' && oc.length > 0) return oc;

  if (pt === 'content_block_start') {
    const blockType = (p.content_block as Record<string, unknown> | undefined)?.type;
    if (blockType === 'server_tool_use' || blockType === 'tool_search_tool_result') {
      return '';
    }
  }

  if (pt === 'content_block_delta') {
    const delta = p.delta as Record<string, unknown> | undefined;
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') return delta.text;
  }

  const candidates = p.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
  if (Array.isArray(candidates) && candidates[0]?.content?.parts) {
    return candidates[0].content.parts.map((x) => (x.text != null ? String(x.text) : '')).join('');
  }

  return '';
}

export function isStreamErrorPayload(
  parsed: unknown,
): parsed is { error: string; detail?: string; provider?: string; model?: string } {
  if (!parsed || typeof parsed !== 'object') return false;
  const p = parsed as { error?: unknown; type?: string };
  if (p.type === 'tool_error' || p.type === 'task_complete') return false;
  return 'error' in p && typeof p.error === 'string';
}

/** Decode minimal XML entities inside `<parameter>` bodies from streamed tool XML. */
function decodeMonacoParameterText(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseMonacoInvokeParameterBlock(inner: string): Record<string, string> {
  const params: Record<string, string> = {};
  const paramRe = /<parameter\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi;
  let m: RegExpExecArray | null;
  while ((m = paramRe.exec(inner)) !== null) {
    const k = m[1].trim().toLowerCase();
    params[k] = decodeMonacoParameterText(m[2].trim());
  }
  return params;
}

/**
 * Remove complete `<invoke name="...">...</invoke>` blocks (any tool name) from streamed assistant text.
 * For `name="monaco"`, parse filename/content and return files to open in the editor.
 */
export function extractMonacoInvokesFromBuffer(text: string): { text: string; files: Array<{ name: string; content: string }> } {
  const files: Array<{ name: string; content: string }> = [];
  let out = text;
  const blockRe = /<(?:antml:)?invoke\b([^>]*)>([\s\S]*?)<\/(?:antml:)?invoke>/i;
  for (let guard = 0; guard < 64; guard++) {
    const m = out.match(blockRe);
    if (!m || m.index === undefined) break;
    const attrs = m[1] || '';
    const inner = m[2] || '';
    const nameMatch = attrs.match(/\bname\s*=\s*["']([^"']+)["']/i);
    const toolName = (nameMatch?.[1] || '').trim().toLowerCase();
    if (toolName === 'monaco') {
      const params = parseMonacoInvokeParameterBlock(inner);
      const nameRaw = params.filename || params.file || params.path || '';
      const filename = (nameRaw || 'snippet.txt').trim() || 'snippet.txt';
      const content = params.content ?? '';
      if (content.length > 0) {
        files.push({ name: filename, content });
      } else {
        console.warn('[ChatAssistant] monaco invoke skipped: missing or empty content parameter', {
          filename,
          paramKeys: Object.keys(params),
        });
      }
    }
    out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
  }
  const fcRe = /<function_calls\b[^>]*>[\s\S]*?<\/function_calls>/i;
  for (let guard = 0; guard < 64; guard++) {
    const m = out.match(fcRe);
    if (!m || m.index === undefined) break;
    out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
  }
  return { text: out, files };
}

/** While the model is still streaming tool XML, hide partial `<function_calls>` / `<invoke>` tails from the bubble. */
export function hideIncompleteMonacoInvokeTail(text: string): string {
  let lastFc = -1;
  const fcOpenRe = /<function_calls\b/gi;
  let fm: RegExpExecArray | null;
  while ((fm = fcOpenRe.exec(text)) !== null) {
    lastFc = fm.index;
  }
  if (lastFc >= 0) {
    const tailFc = text.slice(lastFc);
    if (!/<\/function_calls>/i.test(tailFc)) {
      return text.slice(0, lastFc);
    }
  }
  const openRe = /<(?:antml:)?invoke\b[^>]*>/gi;
  let lastOpen = -1;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(text)) !== null) {
    lastOpen = m.index;
  }
  if (lastOpen < 0) return text;
  const tail = text.slice(lastOpen);
  if (/<\/(?:antml:)?invoke>/i.test(tail)) return text;
  return text.slice(0, lastOpen);
}

/** True when streamed text has clearly entered raw HTML/CSS/SVG body (before r2_file_updated). */
export function looksLikeEmbeddedFileDumpStart(full: string): boolean {
  const tail = full.slice(-14000);
  if (/<!DOCTYPE\s+html/i.test(tail)) return true;
  if (/<\s*html[\s>]/i.test(tail)) return true;
  if (/<\s*head[\s>]/i.test(tail) && /<\s*body[\s>]/i.test(tail)) return true;
  if (/<\s*meta\s+[^>]*charset/i.test(tail)) return true;
  if (/<\s*style[\s>]/i.test(tail) && tail.includes('{') && tail.includes('}')) return true;
  if (/<svg[\s>]/i.test(tail) && tail.length > 400) return true;
  if (/^\s*@(?:charset|import|layer)\s+/im.test(tail.slice(-2500))) return true;
  const m = tail.match(/\{[^{}]*\}/g);
  if (m && m.length >= 18 && /[#.][a-zA-Z0-9_-]+\s*\{/.test(tail)) return true;
  return false;
}

/** True when `index` falls inside an open ``` fence (odd fence count before it). */
export function isIndexInsideMarkdownFence(text: string, index: number): boolean {
  const before = String(text || '').slice(0, Math.max(0, index));
  const fences = before.match(/```/g);
  return Boolean(fences && fences.length % 2 === 1);
}

/**
 * Prefer prose hints like "Save as thompson-visualizer.html"; else a short default.
 */
export function suggestHtmlArtifactFilename(prose: string, fallback = 'visualizer.html'): string {
  const src = String(prose || '');
  const saveAs =
    src.match(
      /\b(?:save\s+as|filename|file\s*name|open\s+as)\s*[:\s]+[`'"]?([a-zA-Z0-9._/-]+\.html?)\b/i,
    ) || src.match(/`([a-zA-Z0-9._/-]+\.html?)`/i);
  const raw = (saveAs?.[1] || '').trim();
  const base = (raw.split(/[/\\]/).pop() || '').replace(/[^a-zA-Z0-9._-]+/g, '_');
  if (base && /\.html?$/i.test(base)) return base;
  return fallback;
}

export type StandaloneHtmlDocument = {
  before: string;
  html: string;
  after: string;
  start: number;
  end: number;
};

/**
 * Pull an unfenced full HTML document out of assistant text (DOCTYPE / <html> … </html>).
 * Skips documents already inside a markdown fence.
 */
export function extractStandaloneHtmlDocument(text: string): StandaloneHtmlDocument | null {
  const src = String(text || '');
  if (src.length < 80) return null;

  const doctype = src.search(/<!DOCTYPE\s+html\b/i);
  const htmlTag = src.search(/<\s*html[\s>]/i);
  let start = -1;
  if (doctype >= 0 && (htmlTag < 0 || doctype <= htmlTag)) start = doctype;
  else if (htmlTag >= 0) start = htmlTag;
  if (start < 0) return null;
  if (isIndexInsideMarkdownFence(src, start)) return null;

  const fromStart = src.slice(start);
  const closeIdx = fromStart.search(/<\/\s*html\s*>/i);
  let end = src.length;
  if (closeIdx >= 0) {
    const closeMatch = fromStart.slice(closeIdx).match(/^<\/\s*html\s*>/i);
    end = start + closeIdx + (closeMatch?.[0]?.length || 7);
  } else if (fromStart.length < 400) {
    return null;
  }

  const html = src.slice(start, end).trim();
  if (html.length < 200) return null;
  // Require enough structure so chat prose with a stray <html> mention is ignored.
  if (!/<\s*(?:head|body|style|script|canvas|div)[\s>]/i.test(html)) return null;

  return {
    before: src.slice(0, start).trimEnd(),
    html,
    after: src.slice(end).trimStart(),
    start,
    end,
  };
}

/**
 * Replace unfenced HTML dumps with a fenced block so chat renders a mini-workstation card
 * instead of a wall of tags. Keeps the full body (Monaco / Live preview need it).
 */
export function collapseEmbeddedFileDumpsForChat(text: string): string {
  const extracted = extractStandaloneHtmlDocument(text);
  if (!extracted) return String(text || '');

  const fence = `\`\`\`html\n${extracted.html}\n\`\`\``;
  const parts = [extracted.before, fence, extracted.after].filter((p) => String(p || '').trim());
  return parts.join('\n\n');
}

const BROWSER_TOOL_RE =
  /^(browser_|cdt_|playwright_)/i;

/** User-facing tool error copy; keeps raw parser noise in `detail`. */
export function normalizeBrowserToolErrorMessage(
  toolName: string,
  rawError: string,
): { short: string; detail: string } {
  const detail = String(rawError || '').trim() || 'Unknown error';
  const tool = String(toolName || '').trim();
  const isBrowserish =
    BROWSER_TOOL_RE.test(tool) || /browser/i.test(tool) || tool === 'browser_navigate';

  if (!isBrowserish) {
    return { short: detail.slice(0, 280), detail };
  }

  const lower = detail.toLowerCase();
  if (/error code:\s*522/.test(lower) || lower.includes('522')) {
    return {
      short: 'Browser preview failed: Cloudflare 522 (origin timeout).',
      detail,
    };
  }
  if (/unexpected token/i.test(detail) && /error code:/i.test(detail)) {
    return {
      short: 'Browser preview failed: response was not JSON (origin may be down).',
      detail,
    };
  }
  if (/unexpected token/i.test(detail) && /is not valid json/i.test(detail)) {
    return {
      short: 'Browser preview failed: response was not JSON.',
      detail,
    };
  }
  if (/^browser error \[/i.test(detail)) {
    const stripped = detail.replace(/^Browser Error \[[^\]]+\]:\s*/i, '').trim();
    if (/unexpected token/i.test(stripped)) {
      return { short: 'Browser preview failed: response was not JSON.', detail };
    }
    return { short: `Browser preview failed: ${stripped.slice(0, 200)}`, detail };
  }

  return { short: `Browser preview failed: ${detail.slice(0, 200)}`, detail };
}

export function formatHttpErrorMessage(status: number, bodyText: string): string {
  try {
    const j = JSON.parse(bodyText) as { error?: string; detail?: string; status?: number; model?: string };
    const parts = [j.error, j.detail, j.model ? `model: ${j.model}` : '', status ? `HTTP ${status}` : ''].filter(
      Boolean,
    );
    if (parts.length) return parts.join(' — ');
  } catch {
    /* use body */
  }
  return bodyText.trim() || `HTTP ${status}`;
}

function phaseFromProgress(progress: number, failed?: boolean): ImageGenerationPhase {
  if (failed) return 'failed';
  if (progress >= 100) return 'completed';
  if (progress >= 70) return 'refining';
  if (progress >= 15) return 'generating';
  return 'initializing';
}

/**
 * Normalize Worker `image_generation_*` SSE payloads for the generation card.
 */
export function normalizeImageGenerationEvent(
  data: unknown,
): { eventType: string; patch: Partial<ImageGenerationState> } | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const eventType = typeof o.type === 'string' ? o.type : '';
  if (!IMAGE_GENERATION_SSE_TYPES.has(eventType)) return null;

  const generationId =
    (typeof o.generation_id === 'string' && o.generation_id.trim()) ||
    (typeof o.batch_id === 'string' && o.batch_id.trim()) ||
    '';
  if (!generationId) return null;

  if (eventType === 'image_generation_started') {
    const variationCountRaw = Number(o.variation_count ?? o.variations ?? 0);
    const variationCount =
      Number.isFinite(variationCountRaw) && variationCountRaw > 1
        ? Math.min(4, Math.floor(variationCountRaw))
        : 1;
    const previewFrames: ImageGenerationPreviewFrame[] =
      variationCount > 1
        ? Array.from({ length: variationCount }, (_, i) => ({
            frameIndex: i,
            phase: 'initializing' as const,
            progress: 0,
            message: `Variation ${i + 1} of ${variationCount}…`,
          }))
        : [];
    return {
      eventType,
      patch: {
        generationId,
        phase: 'initializing',
        provider: typeof o.provider === 'string' ? o.provider : undefined,
        model: typeof o.model === 'string' ? o.model : undefined,
        prompt: typeof o.prompt === 'string' ? o.prompt : undefined,
        width: typeof o.width === 'number' ? o.width : undefined,
        height: typeof o.height === 'number' ? o.height : undefined,
        progress: 0,
        message:
          variationCount > 1
            ? `Creating ${variationCount} images…`
            : 'Creating image…',
        previewFrames,
        activeFrameIndex: 0,
        variationCount,
        failed: false,
      },
    };
  }

  if (eventType === 'image_generation_progress') {
    const progress = typeof o.progress === 'number' ? Math.max(0, Math.min(100, o.progress)) : 0;
    const failed = o.failed === true || o.stage === 'failed';
    const variationIndex =
      typeof o.variation_index === 'number' && Number.isFinite(o.variation_index)
        ? Math.max(0, Math.floor(o.variation_index))
        : typeof o.frame_index === 'number' && Number.isFinite(o.frame_index)
          ? Math.max(0, Math.floor(o.frame_index))
          : typeof o.preview_frame === 'number' && Number.isFinite(o.preview_frame)
            ? Math.max(0, Math.floor(o.preview_frame))
            : null;
    const message = typeof o.message === 'string' ? o.message : 'Working…';
    return {
      eventType,
      patch: {
        generationId,
        phase: phaseFromProgress(progress, failed),
        progress,
        stage: typeof o.stage === 'string' ? o.stage : undefined,
        message,
        failed,
        ...(variationIndex != null
          ? {
              activeFrameIndex: variationIndex,
              previewFrames: [
                {
                  frameIndex: variationIndex,
                  generationId,
                  phase: phaseFromProgress(progress, failed),
                  progress,
                  message,
                  failed,
                },
              ],
            }
          : {}),
      },
    };
  }

  if (eventType === 'image_generation_preview') {
    const previewUrl = typeof o.preview_url === 'string' ? o.preview_url.trim() : '';
    const frameIndex =
      typeof o.frame_index === 'number' && Number.isFinite(o.frame_index)
        ? Math.max(0, Math.floor(o.frame_index))
        : typeof o.variation_index === 'number' && Number.isFinite(o.variation_index)
          ? Math.max(0, Math.floor(o.variation_index))
          : 0;
    if (!previewUrl) return null;
    return {
      eventType,
      patch: {
        generationId,
        phase: 'generating',
        previewFrames: [
          {
            frameIndex,
            previewUrl,
            generationId,
            phase: 'generating',
            progress: 70,
            message: `Variation ${frameIndex + 1} preview…`,
          },
        ],
        activeFrameIndex: frameIndex,
      },
    };
  }

  if (eventType === 'image_generation_complete') {
    const imageUrl = typeof o.image_url === 'string' ? o.image_url.trim() : '';
    const previewUrl = typeof o.preview_url === 'string' ? o.preview_url.trim() : imageUrl;
    const statusRaw = typeof o.status === 'string' ? o.status : imageUrl ? 'draft' : 'completed';
    const failed = o.failed === true || statusRaw === 'failed';
    const status: 'draft' | 'saved' | 'discarded' | undefined =
      statusRaw === 'draft' || statusRaw === 'saved' || statusRaw === 'discarded'
        ? statusRaw
        : failed
          ? undefined
          : imageUrl
            ? 'draft'
            : undefined;
    const explicitFrame =
      typeof o.frame_index === 'number' && Number.isFinite(o.frame_index)
        ? Math.max(0, Math.floor(o.frame_index))
        : typeof o.variation_index === 'number' && Number.isFinite(o.variation_index)
          ? Math.max(0, Math.floor(o.variation_index))
          : null;
    const previewFrames: ImageGenerationPreviewFrame[] = [];
    const pushFrame = (url: string, frameIndex: number, frameGenId?: string) => {
      const u = url.trim();
      if (!u) return;
      const existing = previewFrames.find((f) => f.previewUrl === u || f.frameIndex === frameIndex);
      if (existing) {
        existing.previewUrl = u;
        existing.phase = failed ? 'failed' : 'completed';
        existing.progress = failed ? existing.progress ?? 0 : 100;
        existing.failed = failed;
        if (frameGenId) existing.generationId = frameGenId;
        return;
      }
      previewFrames.push({
        frameIndex,
        previewUrl: u,
        phase: failed ? 'failed' : 'completed',
        progress: failed ? 0 : 100,
        failed,
        ...(frameGenId ? { generationId: frameGenId } : {}),
      });
    };
    if (Array.isArray(o.preview_urls)) {
      o.preview_urls.forEach((u, i) => {
        if (typeof u === 'string') pushFrame(u, i);
      });
    }
    if (Array.isArray(o.variations)) {
      o.variations.forEach((v, i) => {
        if (!v || typeof v !== 'object') return;
        const row = v as {
          image_url?: unknown;
          preview_url?: unknown;
          variation_index?: unknown;
          generation_id?: unknown;
        };
        const u =
          (typeof row.image_url === 'string' && row.image_url) ||
          (typeof row.preview_url === 'string' && row.preview_url) ||
          '';
        const fi =
          typeof row.variation_index === 'number' && Number.isFinite(row.variation_index)
            ? Math.max(0, Math.floor(row.variation_index))
            : i;
        const gid = typeof row.generation_id === 'string' ? row.generation_id.trim() : '';
        if (u) pushFrame(u, fi, gid || undefined);
      });
    }
    // Per-variation completes must keep their slot — never collapse to frame 0.
    if (previewFrames.length === 0 && (previewUrl || imageUrl)) {
      pushFrame(previewUrl || imageUrl, explicitFrame ?? 0, generationId);
    } else if (previewFrames.length === 0 && failed) {
      previewFrames.push({
        frameIndex: explicitFrame ?? 0,
        phase: 'failed',
        progress: 0,
        failed: true,
        message: typeof o.error === 'string' ? o.error : 'Variation failed',
        generationId,
      });
    } else {
      if (previewUrl) pushFrame(previewUrl, explicitFrame ?? previewFrames.length, generationId);
      if (imageUrl && imageUrl !== previewUrl) {
        pushFrame(imageUrl, explicitFrame ?? previewFrames.length, generationId);
      }
    }
    return {
      eventType,
      patch: {
        generationId,
        // Merge decides batch completion when variationCount > 1.
        phase: failed ? 'failed' : 'completed',
        progress: failed ? 0 : 100,
        message: failed
          ? typeof o.error === 'string'
            ? o.error
            : 'Variation failed'
          : '',
        imageUrl: previewUrl || imageUrl || undefined,
        previewUrl: previewUrl || imageUrl || undefined,
        ...(previewFrames.length
          ? {
              previewFrames,
              activeFrameIndex:
                explicitFrame != null ? explicitFrame : previewFrames[previewFrames.length - 1].frameIndex,
            }
          : {}),
        status,
        expiresAt: typeof o.expires_at === 'string' ? o.expires_at : undefined,
        persist: o.persist === true,
        r2Key: typeof o.r2_key === 'string' ? o.r2_key : undefined,
        artifactId: typeof o.artifact_id === 'string' ? o.artifact_id : undefined,
        provider: typeof o.provider === 'string' ? o.provider : undefined,
        model: typeof o.model === 'string' ? o.model : undefined,
        prompt: typeof o.prompt === 'string' ? o.prompt : undefined,
        failed,
        contentTier:
          typeof o.content_tier === 'string'
            ? o.content_tier
            : typeof o.tier === 'string'
              ? o.tier
              : undefined,
        costUsd: typeof o.cost_usd === 'number' ? o.cost_usd : undefined,
      },
    };
  }

  return null;
}

// ── Email draft event ────────────────────────────────────────────────────────
export interface EmailDraftEvent {
  type: 'email_draft';
  subject: string;
  body: string;
  to?: string;
  from?: string;
}

export function isEmailDraftEvent(data: unknown): data is EmailDraftEvent {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    d.type === 'email_draft' &&
    typeof d.subject === 'string' &&
    typeof d.body === 'string'
  );
}
