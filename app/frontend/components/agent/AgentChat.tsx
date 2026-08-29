import React, { FormEvent, useMemo, useState } from 'react';
import { useAgent } from 'agents/react';
import { useAgentChat } from '@cloudflare/think/react';

function textFromMessage(message: any): string {
  if (!Array.isArray(message?.parts)) return '';
  return message.parts
    .filter((part: any) => part?.type === 'text')
    .map((part: any) => String(part.text || ''))
    .join('\n');
}

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

  const visibleMessages = useMemo(() => chat.messages.filter((m: any) => textFromMessage(m).trim()), [chat.messages]);

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
            <div className="as-message-text">{textFromMessage(message)}</div>
          </div>
        ))}
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
          placeholder="Tell Agent Sam what to do"
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
