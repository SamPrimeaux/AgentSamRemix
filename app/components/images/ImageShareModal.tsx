import React, { useEffect, useState } from 'react';
import { Check, Copy, Lock, Link2, Users, X } from 'lucide-react';
import { imagesShareUrl } from './imagesApi';

export type ImageShareMode = 'keep_private' | 'share_team' | 'public_link';

export type ImageShareModalProps = {
  open: boolean;
  onClose: () => void;
  imageId: string;
  deliveryUrl: string;
  workspaceId?: string | null;
};

export function ImageShareModal({
  open,
  onClose,
  imageId,
  deliveryUrl,
  workspaceId,
}: ImageShareModalProps) {
  const [mode, setMode] = useState<ImageShareMode>('keep_private');
  const [emailsRaw, setEmailsRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [sentOk, setSentOk] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('keep_private');
    setEmailsRaw('');
    setBusy(false);
    setError('');
    setCopied(false);
    setSentOk(false);
  }, [open, imageId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const parseEmails = () =>
    emailsRaw
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.includes('@'));

  const sendTeam = async () => {
    const emails = parseEmails();
    if (!emails.length) {
      setError('Add at least one email address.');
      return;
    }
    setBusy(true);
    setError('');
    setSentOk(false);
    try {
      const r = await fetch(imagesShareUrl(imageId, workspaceId), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'email', emails }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) {
        setError(d.error || `Share failed (${r.status})`);
        return;
      }
      setSentOk(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  };

  const copyPublic = async () => {
    try {
      await navigator.clipboard.writeText(deliveryUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to clipboard');
    }
  };

  const radio = (id: ImageShareMode, label: string, icon: React.ReactNode, desc: string) => (
    <label
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '12px 14px',
        borderRadius: 10,
        border:
          mode === id
            ? '1px solid var(--solar-cyan)'
            : '1px solid var(--border-subtle)',
        background:
          mode === id
            ? 'color-mix(in srgb, var(--solar-cyan) 8%, var(--bg-elevated))'
            : 'var(--bg-elevated)',
        cursor: 'pointer',
        marginBottom: 8,
      }}
    >
      <input
        type="radio"
        name="share-mode"
        checked={mode === id}
        onChange={() => {
          setMode(id);
          setError('');
          setSentOk(false);
        }}
        style={{ marginTop: 3 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
          {icon}
          {label}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{desc}</div>
      </div>
    </label>
  );

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        role="dialog"
        aria-labelledby="image-share-title"
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 16,
          padding: 22,
          boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 id="image-share-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            Share image
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {radio('keep_private', 'Keep private', <Lock size={14} />, 'Only you can access this image.')}
        {radio(
          'share_team',
          'Share with team',
          <Users size={14} />,
          'Email delivery link and preview to teammates.',
        )}
        {radio(
          'public_link',
          'Create a public link',
          <Link2 size={14} />,
          'Anyone with the delivery URL can view the image.',
        )}

        {mode === 'share_team' && (
          <div style={{ marginTop: 8, marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>
              Emails (comma or newline separated)
            </label>
            <textarea
              value={emailsRaw}
              onChange={(e) => setEmailsRaw(e.target.value)}
              rows={3}
              placeholder="teammate@example.com"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-elevated)',
                color: 'var(--text-main)',
                fontSize: 13,
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void sendTeam()}
              style={{
                marginTop: 10,
                padding: '8px 14px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--solar-cyan)',
                color: '#000',
                fontSize: 12,
                fontWeight: 600,
                cursor: busy ? 'wait' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
            {sentOk && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--solar-cyan)' }}>
                Share email sent.
              </div>
            )}
          </div>
        )}

        {mode === 'public_link' && (
          <div style={{ marginTop: 8, marginBottom: 8 }}>
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-elevated)',
              }}
            >
              <code
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 11,
                  color: 'var(--text-main)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {deliveryUrl || '—'}
              </code>
              <button
                type="button"
                disabled={!deliveryUrl}
                onClick={() => void copyPublic()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-panel)',
                  color: 'var(--text-main)',
                  fontSize: 11,
                  cursor: deliveryUrl ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit',
                  flexShrink: 0,
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#f87171' }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-muted)',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {mode === 'keep_private' ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImageShareModal;
