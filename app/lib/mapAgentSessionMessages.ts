import { isAgentRuntimeDumpText } from '../shared/agent-runtime/user-visible-agent-error.js';
import type { ImageGenerationState, Message } from '../components/ChatAssistant/types';

export type AgentShellMessage = {
  role: 'user' | 'assistant';
  content: string;
  imageGenerationState?: ImageGenerationState | null;
  agentFiles?: Message['agentFiles'];
};

const MD_IMAGE_RE = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/gi;

/** Hide legacy client-prepended Project memory/instructions from the chat bubble. */
export function stripInjectedProjectBriefForDisplay(content: string): string {
  let s = String(content || '');
  if (!/^Project memory:/im.test(s) && !/^Project instructions:/im.test(s)) return s;
  const parts = s.split(/\r?\n\r?\n---\r?\n\r?\n/);
  if (parts.length > 1) {
    s = parts[parts.length - 1].trim();
  } else {
    s = s
      .replace(/^Project memory:\s*[\s\S]*?(?=\n\nProject instructions:|\n\n---\n\n|$)/i, '')
      .replace(/^Project instructions:\s*[\s\S]*?(?=\n\n---\n\n|$)/i, '')
      .trim();
  }
  return s;
}

function readTextFromUnknown(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(readTextFromUnknown).filter(Boolean).join('\n');
  }
  if (typeof value !== 'object') return '';
  const o = value as Record<string, unknown>;
  if (typeof o.text === 'string' && o.text.trim()) return o.text;
  if (typeof o.content === 'string' && o.content.trim()) return o.content;
  if (typeof o.message === 'string' && o.message.trim()) return o.message;
  if (o.agent_output && typeof o.agent_output === 'object') {
    const ao = o.agent_output as Record<string, unknown>;
    if (typeof ao.text === 'string' && ao.text.trim()) return ao.text;
    if (typeof ao.content === 'string' && ao.content.trim()) return ao.content;
  }
  if (Array.isArray(o.parts)) {
    return o.parts
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        const p = part as Record<string, unknown>;
        if (p.type === 'text' && typeof p.text === 'string') return p.text;
        return readTextFromUnknown(part);
      })
      .filter(Boolean)
      .join('\n');
  }
  if (Array.isArray(o.blocks)) {
    return o.blocks.map(readTextFromUnknown).filter(Boolean).join('\n');
  }
  return '';
}

export function normalizeAgentSessionMessageContent(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const extracted = readTextFromUnknown(JSON.parse(trimmed)).trim();
        if (extracted) return extracted;
        return trimmed;
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  const extracted = readTextFromUnknown(raw).trim();
  if (extracted) return extracted;
  if (raw && typeof raw === 'object') {
    try {
      const serialized = JSON.stringify(raw);
      return isAgentRuntimeDumpText(serialized) ? serialized : '';
    } catch {
      return '';
    }
  }
  return '';
}

/** Rebuild clean image-gen state from persisted markdown so refresh keeps the image(s). */
export function imageGenerationStateFromMarkdown(content: string): ImageGenerationState | null {
  const src = String(content || '');
  const frames: { frameIndex: number; previewUrl: string }[] = [];
  let alt = 'Generated image';
  const re = new RegExp(MD_IMAGE_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const url = (m[2] || '').trim();
    if (!url || frames.some((f) => f.previewUrl === url)) continue;
    if (!frames.length) alt = (m[1] || 'Generated image').trim() || 'Generated image';
    frames.push({ frameIndex: frames.length, previewUrl: url });
  }
  if (!frames.length) return null;
  const primary = frames[0].previewUrl;
  return {
    generationId: `restored_${primary.slice(-12).replace(/[^a-zA-Z0-9]/g, '')}`,
    phase: 'completed',
    progress: 100,
    message: '',
    prompt: alt,
    previewUrl: primary,
    imageUrl: frames[frames.length - 1].previewUrl,
    previewFrames: frames,
    activeFrameIndex: frames.length - 1,
    status: 'draft',
    persist: false,
    failed: false,
  };
}

function agentFilesFromImageState(
  state: ImageGenerationState | null | undefined,
): NonNullable<Message['agentFiles']> {
  if (!state) return [];
  const extFrom = (url?: string) => {
    const path = String(url || '').split('?')[0];
    const m = path.match(/\.(png|jpe?g|webp|gif|svg)$/i);
    if (!m) return 'png';
    const e = m[1].toLowerCase();
    return e === 'jpeg' ? 'jpg' : e;
  };
  const frames = (state.previewFrames || []).filter((f) => Boolean(f.previewUrl));
  if (!frames.length && (state.previewUrl || state.imageUrl)) {
    const url = state.previewUrl || state.imageUrl || '';
    const filename = `variation-1.${extFrom(url)}`;
    return [
      {
        filename,
        r2Url: url,
        workspacePath: `images/${filename}`,
        kind: 'image' as const,
      },
    ];
  }
  return frames.map((f) => {
    const n = f.frameIndex + 1;
    const filename = `variation-${n}.${extFrom(f.previewUrl)}`;
    return {
      filename,
      r2Url: f.previewUrl,
      workspacePath: `images/${filename}`,
      kind: 'image' as const,
    };
  });
}

export function mapAgentSessionMessages(rows: unknown): AgentShellMessage[] {
  if (!Array.isArray(rows)) return [];
  const mapped: AgentShellMessage[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const o = row as { role?: string; content?: unknown; status?: string };
    const role = o.role === 'user' ? 'user' : o.role === 'assistant' ? 'assistant' : null;
    if (!role) continue;
    const status = o.status != null ? String(o.status).trim().toLowerCase() : '';
    let content = normalizeAgentSessionMessageContent(o.content);
    if (role === 'assistant' && isAgentRuntimeDumpText(content)) content = '';
    const imageGenerationState =
      role === 'assistant' ? imageGenerationStateFromMarkdown(content) : null;
    const agentFiles = role === 'assistant' ? agentFilesFromImageState(imageGenerationState) : [];
    // beginChatTurn reserves a pending assistant row with content ''. Never show that as "(empty)".
    if (!content && !imageGenerationState) {
      if (status === 'pending' || role === 'assistant') continue;
    }
    const displayContent = stripInjectedProjectBriefForDisplay(
      content ||
        (imageGenerationState
          ? imageGenerationState.previewFrames
              .map((f, i) => `![Generated image (${i + 1})](${f.previewUrl})`)
              .join('\n')
          : ''),
    );
    if (!displayContent && !imageGenerationState) continue;
    mapped.push({
      role,
      content: displayContent,
      ...(imageGenerationState ? { imageGenerationState } : {}),
      ...(agentFiles.length ? { agentFiles } : {}),
    });
  }
  return mapped;
}

export function agentTabMessagesNeedHydration(
  messages: AgentShellMessage[] | undefined,
  opts?: { hasConversationId?: boolean },
): boolean {
  if (!messages?.length) return true;
  const hasConv = opts?.hasConversationId !== false;
  const placeholderOnly = (c: string) => {
    const t = c.trim();
    return !t || t === '(empty)' || t === 'Loading conversation…';
  };
  const greetingOnly = (c: string) => {
    const t = c.trim();
    if (!t) return true;
    // Fresh-tab greeting must not block history hydrate when a conversation id is set.
    if (/^Hi!\s*I'm Agent Sam\./i.test(t)) return true;
    if (/What should we work on\?/i.test(t) && t.length < 280) return true;
    return false;
  };
  if (messages.every((m) => placeholderOnly(m.content) && !m.imageGenerationState)) return true;
  if (
    hasConv &&
    messages.length === 1 &&
    messages[0].role === 'assistant' &&
    (placeholderOnly(messages[0].content) || greetingOnly(messages[0].content)) &&
    !messages[0].imageGenerationState
  ) {
    return true;
  }
  return false;
}

export async function fetchAgentSessionMessages(conversationId: string): Promise<AgentShellMessage[]> {
  const convId = String(conversationId || '').trim();
  if (!convId) return [];
  const r = await fetch(`/api/agent/sessions/${encodeURIComponent(convId)}/messages`, {
    credentials: 'same-origin',
  });
  if (!r.ok) return [];
  const rows = await r.json().catch(() => []);
  return mapAgentSessionMessages(rows);
}

/** Narrow helper for App message state typing. */
export function asChatMessages(rows: AgentShellMessage[]): Message[] {
  return rows as Message[];
}
