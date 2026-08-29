import React, { useMemo, useState } from 'react';
import { BookOpen, Film } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { CF_STREAM_DOCS_URL } from './videosRegistry';

export type VideosOutletContext = {
  workspaceId?: string | null;
  setDocsUrl: (url: string | null) => void;
};

export type VideosShellProps = {
  workspaceId?: string | null;
};

const SHELL_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export function VideosShell({ workspaceId }: VideosShellProps) {
  const [docsUrlOverride, setDocsUrlOverride] = useState<string | null>(null);
  const ctx: VideosOutletContext = useMemo(
    () => ({ workspaceId, setDocsUrl: setDocsUrlOverride }),
    [workspaceId],
  );
  const docsUrl = docsUrlOverride || CF_STREAM_DOCS_URL;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-app)',
        color: 'var(--text-main)',
        fontFamily: SHELL_FONT,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '16px 24px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-app)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Film size={18} style={{ color: 'var(--solar-cyan)', flexShrink: 0 }} />
            <h1
              style={{
                margin: 0,
                fontWeight: 600,
                fontSize: 20,
                letterSpacing: '-0.01em',
                color: 'var(--text-main)',
                fontFamily: SHELL_FONT,
              }}
            >
              Hosted videos
            </h1>
          </div>
          <a
            href={docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-main)',
              fontSize: 12,
              fontWeight: 500,
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            <BookOpen size={13} />
            Documentation
          </a>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Outlet context={ctx} />
      </div>
    </div>
  );
}

export default VideosShell;
