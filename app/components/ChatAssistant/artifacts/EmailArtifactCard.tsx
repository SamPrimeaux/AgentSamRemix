import React, { useState } from 'react';
import type { EmailArtifact } from '../types';
import { AgentChatMarkdown } from '../components/AgentChatMarkdown';

interface EmailArtifactCardProps {
  artifact: EmailArtifact;
}

export function EmailArtifactCard({ artifact }: EmailArtifactCardProps) {
  const { subject, body, to } = artifact;
  const [copyLabel, setCopyLabel] = useState<'Copy' | 'Copied ✓'>('Copy');
  const [sendState, setSendState] = useState<'idle'|'sending'|'sent'|'failed'>('idle');

  function handleCopy() {
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).then(() => {
      setCopyLabel('Copied ✓');
      setTimeout(() => setCopyLabel('Copy'), 1500);
    });
  }

  function handleOpenInMail() {
    window.open(
      `mailto:${to ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    );
  }

  async function handleSend() {
    setSendState('sending');
    try {
      const r = await fetch('/api/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, from: '', subject, html: body, text: body }),
      });
      setSendState(r.ok ? 'sent' : 'failed');
    } catch { setSendState('failed'); }
  }

  return (
    <div style={{
      margin: '10px 0 4px',
      border: '0.5px solid var(--color-border-secondary, rgba(255,255,255,0.12))',
      borderRadius: '12px',
      overflow: 'hidden',
      background: 'var(--color-background-secondary, rgba(255,255,255,0.03))',
    }}>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 14px 8px',
        borderBottom: '0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.07))',
      }}>
        <span style={{
          fontSize: '11px', fontWeight: 500, letterSpacing: '0.07em',
          textTransform: 'uppercase',
          color: 'var(--color-text-tertiary, rgba(255,255,255,0.32))',
        }}>
          Email draft
        </span>
        {to && (
          <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary, rgba(255,255,255,0.32))' }}>
            To: {to}
          </span>
        )}
      </div>

      {/* ── Subject ── */}
      <div style={{ padding: '12px 14px 10px' }}>
        <div style={{
          fontSize: '14px', fontWeight: 500,
          color: 'var(--color-text-primary)',
          lineHeight: 1.4,
        }}>
          {subject}
        </div>
      </div>

      {/* ── Body — rendered markdown ── */}
      <div style={{
        padding: '0 14px 4px',
        maxHeight: '320px',
        overflowY: 'auto',
        borderTop: '0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.07))',
      }}>
        <div style={{ paddingTop: '10px', paddingBottom: '10px' }}>
          <AgentChatMarkdown source={body} />
        </div>
      </div>

      {/* ── Action row ── */}
      <div style={{
        display: 'flex', gap: '2px', padding: '8px 10px',
        borderTop: '0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.07))',
        background: 'var(--color-background-tertiary, rgba(0,0,0,0.15))',
      }}>
        <Btn icon="copy" onClick={handleCopy}>{copyLabel}</Btn>
        <Btn icon="mail" onClick={handleOpenInMail}>Open in Mail</Btn>
        <Btn
          icon="send"
          onClick={handleSend}
          disabled={sendState !== 'idle'}
          faded={sendState !== 'idle'}
        >
          {sendState === 'idle'    && 'Send via Resend'}
          {sendState === 'sending' && 'Sending…'}
          {sendState === 'sent'    && 'Sent ✓'}
          {sendState === 'failed'  && 'Failed — retry?'}
        </Btn>
      </div>
    </div>
  );
}

function Btn({ icon, onClick, disabled, faded, children }: {
  icon: string; onClick: () => void;
  disabled?: boolean; faded?: boolean;
  children: React.ReactNode;
}) {
  const [hov, setHov] = React.useState(false);
  return (
    <button
      onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        fontSize: '12px', padding: '5px 9px', borderRadius: '7px',
        border: 'none', cursor: disabled ? 'default' : 'pointer',
        background: hov && !disabled
          ? 'var(--color-background-secondary, rgba(255,255,255,0.07))'
          : 'transparent',
        color: faded
          ? 'var(--color-text-tertiary, rgba(255,255,255,0.3))'
          : 'var(--color-text-secondary)',
        transition: 'background 0.12s, color 0.12s',
      }}
    >
      <i className={`ti ti-${icon}`} aria-hidden="true" style={{ fontSize: '14px' }} />
      {children}
    </button>
  );
}
