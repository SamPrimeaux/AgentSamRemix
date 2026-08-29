import React, { FormEvent, useMemo, useState } from 'react';
import { useAgent } from 'agents/react';
import { useAgentChat } from '@cloudflare/think/react';
import { getToolName, isToolUIPart } from 'ai';
import {
  Check,
  Circle,
  FileText,
  Globe2,
  LoaderCircle,
  Pencil,
  Search,
  ShieldCheck,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';

function textFromMessage(message: any): string {
  if (!Array.isArray(message?.parts)) return '';
  return message.parts
    .filter((part: any) => part?.type === 'text')
    .map((part: any) => String(part.text || ''))
    .join('\n');
}

function messageHasVisibleParts(message: any): boolean {
  if (!Array.isArray(message?.parts)) return false;
  return message.parts.some((part: any) => {
    if (part?.type === 'text') return Boolean(String(part.text || '').trim());
    return isToolUIPart(part);
  });
}

function humanizeToolName(toolName: string): string {
  return toolName
    .replace(/^tools[.:/_-]?/i, '')
    .replace(/[._/-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || 'Tool';
}

function toolIcon(toolName: string) {
  const name = toolName.toLowerCase();
  if (/(bash|terminal|exec|command|shell)/.test(name)) return Terminal;
  if (/(edit|write|patch|delete)/.test(name)) return Pencil;
  if (/(read|file|list)/.test(name)) return FileText;
  if (/(find|grep|search)/.test(name)) return Search;
  if (/(browser|navigate|url|web)/.test(name)) return Globe2;
  return Wrench;
}

function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactPayload(item, depth + 1));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…`;
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
    if (/(secret|token|password|authorization|cookie|credential|api[_-]?key)/i.test(key)) {
      output[key] = '[redacted]';
    } else {
      output[key] = redactPayload(item, depth + 1);
    }
  }
  return output;
}

function payloadPreview(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').slice(0, 150);
  if (typeof value !== 'object') return String(value);

  const record = value as Record<string, unknown>;
  const preferred = ['command', 'path', 'url', 'query', 'cwd', 'lane', 'target', 'repo', 'branch', 'error'];
  for (const key of preferred) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return `${key}: ${candidate.replace(/\s+/g, ' ').slice(0, 135)}`;
    }
  }

  try {
    return JSON.stringify(redactPayload(value)).slice(0, 150);
  } catch {
    return '';
  }
}

function prettyPayload(value: unknown): string {
  if (value == null) return '';
  try {
    const rendered = typeof value === 'string'
      ? value
      : JSON.stringify(redactPayload(value), null, 2);
    return rendered.length > 4000 ? `${rendered.slice(0, 4000)}\n…` : rendered;
  } catch {
    return String(value).slice(0, 4000);
  }
}

function toolStateMeta(state: string) {
  if (state === 'output-available') return { label: 'Completed', className: 'complete', Icon: Check };
  if (state === 'output-error') return { label: 'Failed', className: 'failed', Icon: X };
  if (state === 'output-denied') return { label: 'Denied', className: 'denied', Icon: X };
  if (state === 'approval-requested') return { label: 'Approval needed', className: 'approval', Icon: ShieldCheck };
  if (state === 'approval-responded') return { label: 'Approved', className: 'working', Icon: LoaderCircle };
  if (state === 'input-streaming' || state === 'input-available') return { label: 'Running', className: 'working', Icon: LoaderCircle };
  return { label: state || 'Pending', className: 'pending', Icon: Circle };
}

interface ToolActivityProps {
  part: any;
  onApproval: (id: string, approved: boolean) => void;
}

const ToolActivity: React.FC<ToolActivityProps> = ({ part, onApproval }) => {
  const toolName = getToolName(part);
  const ToolIcon = toolIcon(toolName);
  const meta = toolStateMeta(String(part.state || 'pending'));
  const StatusIcon = meta.Icon;
  const inputPreview = payloadPreview(part.input);
  const outputPreview = payloadPreview(part.output || part.errorText);
  const summary = outputPreview || inputPreview;
  const approvalId = 'approval' in part ? part.approval?.id : undefined;

  return (
    <details className={`as-tool-activity as-tool-${meta.className}`}>
      <summary>
        <span className="as-tool-icon"><ToolIcon size={17} strokeWidth={1.8} /></span>
        <span className="as-tool-copy">
          <strong>{humanizeToolName(toolName)}</strong>
          {summary && <small>{summary}</small>}
        </span>
        <span className="as-tool-state">
          <StatusIcon className={meta.className === 'working' ? 'spin' : ''} size={15} strokeWidth={2} />
          <span>{meta.label}</span>
        </span>
      </summary>

      <div className="as-tool-details">
        {part.input !== undefined && (
          <div>
            <span>Input</span>
            <pre>{prettyPayload(part.input)}</pre>
          </div>
        )}
        {(part.output !== undefined || part.errorText) && (
          <div>
            <span>{part.errorText ? 'Error' : 'Output'}</span>
            <pre>{prettyPayload(part.errorText || part.output)}</pre>
          </div>
        )}

        {part.state === 'approval-requested' && approvalId && (
          <div className="as-tool-approval-actions">
            <button type="button" className="approve" onClick={() => onApproval(approvalId, true)}>Approve</button>
            <button type="button" className="reject" onClick={() => onApproval(approvalId, false)}>Reject</button>
          </div>
        )}
      </div>
    </details>
  );
};

export interface AgentChatProps {
  agentName: string;
  compact?: boolean;
  initialPrompt?: string;
  onPromptConsumed?: () => void;
}

export const AgentChat: React.FC<AgentChatProps> = ({ agentName, compact = false, initialPrompt, onPromptConsumed }) => {
  const agent = useAgent({ agent: 'AgentSam', name: agentName });
  const chat = useAgentChat({ agent });
  const [input, setInput] = useState('');

  React.useEffect(() => {
    if (!initialPrompt?.trim()) return;
    void chat.sendMessage({ role: 'user', parts: [{ type: 'text', text: initialPrompt.trim() }] });
    onPromptConsumed?.();
  }, [initialPrompt]);

  const visibleMessages = useMemo(() => chat.messages.filter(messageHasVisibleParts), [chat.messages]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || chat.status === 'submitted' || chat.status === 'streaming') return;
    setInput('');
    await chat.sendMessage({ role: 'user', parts: [{ type: 'text', text }] });
  }

  return (
    <div className={`as-chat ${compact ? 'as-chat-compact' : ''}`}>
      <div className="as-chat-stream">
        {visibleMessages.length === 0 ? (
          <div className="as-chat-empty">
            <div className="as-chat-mark">AS</div>
            <strong>What should we work on?</strong>
            <span>Real Think agent · durable chat · Code Mode · ExecOS · Browser Run</span>
          </div>
        ) : visibleMessages.map((message: any) => (
          <div key={message.id} className={`as-message as-message-${message.role}`}>
            <div className="as-message-role">{message.role === 'user' ? 'You' : 'Agent Sam'}</div>
            <div className="as-message-parts">
              {message.parts.map((part: any, index: number) => {
                if (part?.type === 'text' && String(part.text || '').trim()) {
                  return <div key={`${message.id}-text-${index}`} className="as-message-text">{String(part.text)}</div>;
                }
                if (isToolUIPart(part)) {
                  return (
                    <ToolActivity
                      key={part.toolCallId || `${message.id}-tool-${index}`}
                      part={part}
                      onApproval={(id, approved) => chat.addToolApprovalResponse({ id, approved })}
                    />
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}
        {(chat.status === 'submitted' || chat.status === 'streaming') && (
          <div className="as-chat-live-status"><LoaderCircle size={14} className="spin" /> Agent Sam is working</div>
        )}
        {chat.error && <div className="as-chat-error">{chat.error.message}</div>}
      </div>
      <form className="as-composer" onSubmit={submit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Message Agent Sam…"
          rows={compact ? 2 : 3}
        />
        <div className="as-composer-footer">
          <div className="as-composer-meta"><span>∞ Agent</span><span>Think</span><span>Code Mode</span></div>
          {chat.status === 'streaming' || chat.status === 'submitted' ? (
            <button type="button" onClick={() => chat.stop()} className="as-send">Stop</button>
          ) : (
            <button type="submit" className="as-send" disabled={!input.trim()}>↑</button>
          )}
        </div>
      </form>
    </div>
  );
};
