/**
 * Shared helpers for Agent Sam SSE consume (text/artifact/browser utils).
 */
import type { AgentGeneratedFile } from '../../types';
import { collapseEmbeddedFileDumpsForChat } from '../../streamParsing';

/** Prefer agentsam_agent_run.id over legacy wrun_* when both appear on SSE payloads. */
export function sseSpineRunId(d: { agent_run_id?: unknown; run_id?: unknown }): string {
  if (typeof d.agent_run_id === 'string' && d.agent_run_id.trim()) return d.agent_run_id.trim();
  if (typeof d.run_id === 'string' && d.run_id.trim()) return d.run_id.trim();
  return '';
}

export function extForStreamOutput(lang: string): string {
  const map: Record<string, string> = {
    tsx: 'tsx',
    jsx: 'jsx',
    ts: 'ts',
    js: 'js',
    css: 'css',
    html: 'html',
    json: 'json',
    py: 'py',
    python: 'py',
    sh: 'sh',
  };
  return map[lang] || lang || 'txt';
}

export function isBrowserScreenshotToolName(name: string): boolean {
  const n = String(name || '').trim().toLowerCase();
  return n === 'cdt_take_screenshot' || n === 'playwright_screenshot' || n === 'browser_screenshot';
}

/** Pull image URL + generation id from imgx tool_done / tool_output JSON. */
export function parseImgxToolPayload(raw: string | null | undefined): {
  imageUrl: string | null;
  generationId: string | null;
  status: string | null;
} {
  const empty = { imageUrl: null as string | null, generationId: null as string | null, status: null as string | null };
  if (!raw?.trim()) return empty;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const candidates = [parsed.image_url, parsed.imageUrl, parsed.public_url, parsed.url, parsed.preview_url];
    let imageUrl: string | null = null;
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim() && (/^https?:/i.test(c.trim()) || c.trim().startsWith('/'))) {
        imageUrl = c.trim();
        break;
      }
    }
    const generationId =
      typeof parsed.generation_id === 'string' && parsed.generation_id.trim()
        ? parsed.generation_id.trim()
        : typeof parsed.generationId === 'string' && parsed.generationId.trim()
          ? parsed.generationId.trim()
          : null;
    const status = typeof parsed.status === 'string' ? parsed.status.trim() : null;
    return { imageUrl, generationId, status };
  } catch {
    return empty;
  }
}

export function isCdtBrowserToolName(name: string): boolean {
  return String(name || '').trim().toLowerCase().startsWith('cdt_');
}

export function truncateLines(text: string, maxLines: number): { head: string; truncated: boolean; total: number } {
  const lines = String(text || '').split('\n');
  if (lines.length <= maxLines) return { head: String(text || ''), truncated: false, total: lines.length };
  return { head: lines.slice(0, maxLines).join('\n'), truncated: true, total: lines.length };
}

export function truncateCodeFencesForChat(text: string, maxLines = 200): string {
  const src = String(text || '');
  const re = /```(\w+)?\n([\s\S]*?)\n```/g;
  return src.replace(re, (_full, lang, body) => {
    const b = String(body || '');
    const langKey = String(lang || '').toLowerCase();
    // Single-file HTML/CSS/SVG apps flood chat — keep a short fence card, open full in Monaco.
    const effectiveMax =
      langKey === 'html' || langKey === 'htm' || langKey === 'css' || langKey === 'svg'
        ? Math.min(maxLines, 12)
        : maxLines;
    const { head, truncated, total } = truncateLines(b, effectiveMax);
    if (!truncated) return `\`\`\`${lang || ''}\n${b}\n\`\`\``;
    return `\`\`\`${lang || ''}\n${head}\n\`\`\`\n_(truncated: showing first ${effectiveMax} of ${total} lines — open Monaco for full content)_`;
  });
}

/** Collapse unfenced HTML dumps, then truncate fenced bodies for chat display. */
export function prepareAssistantChatText(text: string, maxLines = 200): string {
  return truncateCodeFencesForChat(collapseEmbeddedFileDumpsForChat(text), maxLines);
}

export function openHtmlArtifactInWorkbench(name: string, content: string, onFileSelect?: (f: { name: string; content: string }) => void) {
  if (!onFileSelect || !content.trim()) return;
  onFileSelect({ name, content });
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('iam:agent-open-surface', {
      detail: { surface: 'code', reason: 'html_artifact' },
    }),
  );
  window.dispatchEvent(
    new CustomEvent('iam:open-editor-preview', {
      detail: { file: { name, content, originalContent: content } },
    }),
  );
}

export function parseBrowserToolAutomationFlag(inp: Record<string, unknown>): boolean {
  return inp.automation === true || inp.use_automation === true || inp.automate === true;
}

export function resolveAgentFileKind(filename: string): AgentGeneratedFile['kind'] {
  const ext = String(filename || '').split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'md') return 'md';
  if (ext === 'sql') return 'sql';
  if (ext === 'ts' || ext === 'tsx') return 'ts';
  if (ext === 'js' || ext === 'jsx') return 'js';
  if (ext === 'json') return 'json';
  if (ext === 'txt') return 'txt';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp' || ext === 'gif') return 'image';
  return 'other';
}
