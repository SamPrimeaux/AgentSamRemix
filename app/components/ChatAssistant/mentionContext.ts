/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ActiveFile } from '../../types';
import type { ContextEnvelopeV1 } from '../../types/contextEnvelope';
import { buildContextEnvelopeMessageBlock } from '../../types/contextEnvelope';
import {
  MENTION_CONTEXT_HEADER,
  MENTION_FILE_MAX_CHARS,
  MENTION_R2_LIST_MAX_ROWS,
} from './types';

function hasWordMention(text: string, tag: string): boolean {
  return new RegExp(`@${tag}\\b`).test(text);
}

/** Composer / @-mention token for a BrowserView element pick (Cursor-style context attachment). */
export function browserMentionInMessage(text: string): boolean {
  return /@browser(?::[^\s@]*)?/.test(text);
}

/** Short `@browser:…` label inserted into the chat input when the user picks an element. */
export function browserElementMentionToken(ctx: Record<string, unknown>): string {
  const tag = String(ctx.tag || ctx.tagName || 'element').toLowerCase();
  const id = ctx.id ? `#${String(ctx.id)}` : '';
  const clsRaw = ctx.className != null ? String(ctx.className).trim().split(/\s+/)[0] : '';
  const cls = clsRaw ? `.${clsRaw.replace(/[^\w-]/g, '')}` : '';
  const path = String(ctx.selector || ctx.path || '').trim();
  const leaf = path.includes(' > ') ? path.split(' > ').pop() || path : path;
  const compact = (leaf || `${tag}${id}${cls}`).replace(/\s+/g, '');
  const safe = compact.replace(/[^\w#.\->[\]()]/g, '').slice(0, 56);
  return safe ? `browser:${safe}` : 'browser';
}

export function formatBrowserElementContextBlock(ctx: Record<string, unknown>): string {
  const tag = String(ctx.tag || ctx.tagName || '?');
  const selector = String(ctx.selector || ctx.path || '');
  const url = String(ctx.url || '');
  const text = typeof ctx.text === 'string' ? ctx.text : typeof ctx.text_preview === 'string' ? ctx.text_preview : '';
  const lines = [
    '### @browser',
    `Page: ${url || '(unknown)'}`,
    `Element: <${tag}${ctx.id ? ` id="${String(ctx.id)}"` : ''}${ctx.className ? ` class="${String(ctx.className)}"` : ''}>`,
    selector ? `Selector: ${selector}` : '',
    text ? `Text preview: ${text.slice(0, 500)}` : '',
    'Structured selection (JSON):',
    '```json',
    JSON.stringify(ctx, null, 2),
    '```',
  ].filter(Boolean);
  return lines.join('\n');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Mention picker inserts `@${label}` (e.g. `@cms.html`), not literal `@file` — match those too. */
function fileNameMentionedInMessage(userMessage: string, activeFileName?: string): boolean {
  if (!activeFileName?.trim()) return false;
  const t = activeFileName.trim();
  const variants = new Set<string>([t]);
  const base = t.includes('/') ? t.split('/').pop() || t : t;
  if (base && base !== t) variants.add(base);
  for (const v of variants) {
    const re = new RegExp(`@${escapeRegExp(v)}(?:\\s|$|[,;:!?])`);
    if (re.test(userMessage)) return true;
  }
  return false;
}

/** Path-like id for lightweight injection (no buffer), similar to Cursor open-file metadata. */
export function getEditorLightweightPath(af: ActiveFile | null | undefined): string | null {
  if (!af) return null;
  if (af.workspacePath?.trim()) return af.workspacePath.trim();
  if (af.r2Key?.trim()) return `r2:${af.r2Bucket || 'DASHBOARD'}/${af.r2Key}`;
  if (af.githubRepo && af.githubPath) return `${af.githubRepo}/${af.githubPath}`;
  if (af.driveFileId?.trim()) return `drive:${af.driveFileId}`;
  return null;
}

/** Display path for editor UI (lightweight path, else filename). */
export function getEditorDisplayPath(af: ActiveFile, activeFileName?: string): string {
  const light = getEditorLightweightPath(af);
  if (light) return light;
  if (af.name?.trim()) return af.name.trim();
  if (activeFileName?.trim()) return activeFileName.trim();
  return '(unnamed)';
}

const CHAT_TEXT_CODE_EXT = new Set(['js', 'ts', 'tsx', 'jsx', 'css', 'html', 'htm', 'sql', 'md', 'json', 'py', 'sh']);

export function isChatTextCodeFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return CHAT_TEXT_CODE_EXT.has(ext);
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : '');
    fr.onerror = () => reject(fr.error);
    fr.readAsText(file);
  });
}

/** Tells the model exactly which tools and parameters map to the open editor buffer (must match worker tool loop). */
function formatAgentToolRouting(activeFile: ActiveFile | null | undefined): string {
  const lines: string[] = [
    '### Agent tool targets (read/write this buffer)',
    'When ### @file content appears below, use it directly — do not github_file to re-fetch the open buffer.',
    'If the user asks to change, save, or sync this file, call the matching tool with the exact ids below — do not only paste code in chat when persistence is requested.',
  ];
  if (!activeFile) {
    lines.push(
      '- No file is open in the editor. Open a file from R2, GitHub, Drive, or the local folder, then use @file, @monaco, or @YourFileName (mention picker uses the file label).',
    );
    return lines.join('\n');
  }
  if (activeFile.r2Key) {
    const b = activeFile.r2Bucket || 'DASHBOARD';
    lines.push(
      `- R2: r2_read({ bucket: "${b}", key: "${activeFile.r2Key}" }) before large edits; r2_write({ bucket: "${b}", key: "${activeFile.r2Key}", body: <full file text>, content_type: as appropriate e.g. application/javascript, text/html }). To delete this object: r2_delete({ bucket: "${b}", key: "${activeFile.r2Key}" }) — destructive; ask mode may require user approval before execution. Bucket may be DASHBOARD (agent-sam) or logical names like agent-sam — both resolve. After r2_write the dashboard reloads this key.`,
    );
  }
  if (activeFile.githubRepo && activeFile.githubPath) {
    const branch = activeFile.githubBranch ? ` ref="${activeFile.githubBranch}"` : '';
    lines.push(
      `- GitHub read: agentsam_github_read({ repo: "${activeFile.githubRepo}", path: "${activeFile.githubPath}"${branch} })`,
      `- GitHub write: agentsam_github_write / github_update_file({ repo: "${activeFile.githubRepo}", path: "${activeFile.githubPath}", content: "<full file text>", message: "<commit message>"${branch} }) — call this when the user asks to patch/save/commit.`,
    );
  }
  if (activeFile.driveFileId) {
    lines.push(
      `- Google Drive: use gdrive_fetch / gdrive_list with this file id where applicable: ${activeFile.driveFileId}`,
    );
  }
  if (activeFile.handle) {
    lines.push(
      '- Local file (File System Access in the browser): the worker cannot write to this path directly. Use terminal_execute if the repo exists in the user PTY, or ask the user to save in the editor.',
    );
  }
  if (activeFile.workspacePath && !activeFile.githubPath && !activeFile.r2Key) {
    lines.push(
      `- Local workspace buffer: workspace_path="${activeFile.workspacePath}". Content is in ### Open file (editor) — analyze it in chat; persist with terminal_execute or open from GitHub explorer for github_update_file.`,
    );
  }
  if (!activeFile.r2Key && !activeFile.githubPath && !activeFile.driveFileId && !activeFile.handle && !activeFile.workspacePath) {
    lines.push(
      '- New buffer with no storage binding. To persist, use r2_write with an explicit bucket and key the user names, or ask where to save.',
    );
  }
  return lines.join('\n');
}

/**
 * Append explicit @-mention / attachment payloads only.
 * No ambient open-file body, editor path, or tool-routing dump — use @file / @Name / tools.
 */
export async function buildMentionContext(
  userMessage: string,
  opts: {
    activeFileName?: string;
    activeFileContent?: string | null;
    activeFile?: ActiveFile | null;
    editorCursorLine?: number;
    editorCursorColumn?: number;
    /** Text/code attachments: same injection shape as @file for the active buffer. */
    attachContextFiles?: Array<{ name: string; content: string }>;
    /** BrowserView element pick — injected when message includes `@browser`. */
    browserElementContext?: Record<string, unknown> | null;
    /** Locked GitHub focus — only when envelope has an explicit path (user-locked). */
    contextEnvelope?: ContextEnvelopeV1 | null;
  },
): Promise<string> {
  const {
    activeFileName,
    activeFileContent,
    activeFile,
    editorCursorLine,
    editorCursorColumn,
    attachContextFiles,
    browserElementContext,
    contextEnvelope,
  } = opts;
  const parts: string[] = [];
  const injectFileSnippet =
    (hasWordMention(userMessage, 'file') || fileNameMentionedInMessage(userMessage, activeFileName)) &&
    activeFileContent != null &&
    activeFileContent !== '';

  if (injectFileSnippet) {
    parts.push(`### @file\n${activeFileName || 'untitled'}\n\n${activeFileContent.slice(0, MENTION_FILE_MAX_CHARS)}`);
    if (activeFile) parts.push(formatAgentToolRouting(activeFile));
  }

  if (attachContextFiles?.length) {
    for (const f of attachContextFiles) {
      parts.push(`### @${f.name}\n\n${f.content.slice(0, MENTION_FILE_MAX_CHARS)}`);
    }
  }

  if (hasWordMention(userMessage, 'monaco')) {
    const totalLines =
      activeFileContent != null && activeFileContent !== '' ? activeFileContent.split('\n').length : 0;
    const cl = editorCursorLine ?? 1;
    const cc = editorCursorColumn ?? 1;
    parts.push(
      `### @monaco\nFile: ${activeFileName || '(none)'}\nTotal lines: ${totalLines}\nCursor: line ${cl}, column ${cc}`,
    );
  }

  if (contextEnvelope?.focus?.github?.path) {
    const block = buildContextEnvelopeMessageBlock(contextEnvelope);
    if (block) parts.push(`### Context envelope (locked)\n${block}`);
  }

  const r2Re = /@r2:([^\s]+)/g;
  const seenBuckets = new Set<string>();
  const r2Buckets: string[] = [];
  let rm: RegExpExecArray | null;
  while ((rm = r2Re.exec(userMessage)) !== null) {
    const b = rm[1];
    if (b && !seenBuckets.has(b)) {
      seenBuckets.add(b);
      r2Buckets.push(b);
    }
  }
  for (const bucket of r2Buckets) {
    try {
      const res = await fetch(`/api/r2/list?${new URLSearchParams({ bucket, prefix: '' })}`, {
        credentials: 'same-origin',
      });
      const data = (await res.json()) as { objects?: Array<{ key?: string; size?: number }> };
      if (!res.ok) {
        parts.push(`### @r2:${bucket}\n(list failed: HTTP ${res.status})`);
        continue;
      }
      const objects = Array.isArray(data.objects) ? data.objects : [];
      const body = objects
        .slice(0, MENTION_R2_LIST_MAX_ROWS)
        .map((o) => `${o.key ?? ''}\t${String(o.size ?? '')}`)
        .join('\n');
      parts.push(`### @r2:${bucket}\n${body || '(empty)'}`);
    } catch (e) {
      parts.push(`### @r2:${bucket}\n(${String(e instanceof Error ? e.message : e)})`);
    }
  }

  if (
    browserElementContext &&
    typeof browserElementContext === 'object' &&
    browserMentionInMessage(userMessage)
  ) {
    parts.push(formatBrowserElementContextBlock(browserElementContext));
  }

  if (hasWordMention(userMessage, 'd1')) {
    let d1 = '';
    try {
      d1 = sessionStorage.getItem('iam_d1_last_result') || '';
    } catch {
      /* sessionStorage unavailable */
    }
    parts.push(
      `### @d1\n${
        d1 ||
        '(No stored D1 result in this session. SQL explorer can set sessionStorage key iam_d1_last_result.)'
      }`,
    );
  }

  if (parts.length === 0) return userMessage;
  return `${userMessage}${MENTION_CONTEXT_HEADER}${parts.join('\n\n')}`;
}
