import React, { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BookOpen, ImageIcon } from 'lucide-react';
import { IMAGES_TABS } from './imagesRegistry';

export type ImagesOutletContext = {
  workspaceId?: string | null;
  setDocsUrl: (url: string | null) => void;
};

export type ImagesShellProps = {
  workspaceId?: string | null;
};

const CF_IMAGES_DOCS_URL = 'https://developers.cloudflare.com/images/';

const LIST_SEGMENTS = new Set(['storage', 'delivery', 'keys', 'sourcing-kit']);

/** True for /dashboard/images/:id and /:id/edit — not list tabs. */
function useImagesDetailRoute() {
  const { pathname } = useLocation();
  const parts = pathname.replace(/\/+$/, '').split('/');
  const seg = parts[3] || '';
  if (!seg || LIST_SEGMENTS.has(seg)) return false;
  return true;
}

/**
 * Lets a nested page override the shell's "Documentation" link to a more specific
 * CF doc page for the duration it's mounted.
 */
export function ImagesShell({ workspaceId }: ImagesShellProps) {
  const [docsUrlOverride, setDocsUrlOverride] = useState<string | null>(null);
  const ctx: ImagesOutletContext = useMemo(
    () => ({ workspaceId, setDocsUrl: setDocsUrlOverride }),
    [workspaceId],
  );
  const docsUrl = docsUrlOverride || CF_IMAGES_DOCS_URL;
  const detailRoute = useImagesDetailRoute();

  const font =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  const header = (
    <div
      style={{
        padding: '16px 24px 0',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-app)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ImageIcon size={18} style={{ color: 'var(--solar-cyan)', flexShrink: 0 }} />
          <h1
            style={{
              margin: 0,
              fontWeight: 600,
              fontSize: 20,
              letterSpacing: '-0.01em',
              color: 'var(--text-main)',
              fontFamily: font,
            }}
          >
            Hosted images
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
      <nav style={{ display: 'flex', gap: 0, overflowX: 'auto' }} aria-label="Images sections">
        {IMAGES_TABS.map((tab) => (
          <NavLink
            key={tab.id}
            to={tab.path}
            end
            style={({ isActive }) => ({
              padding: '10px 16px',
              fontSize: 12,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? 'var(--solar-cyan)' : 'var(--text-muted)',
              textDecoration: 'none',
              borderBottom: isActive
                ? '2px solid var(--solar-cyan)'
                : '2px solid transparent',
              whiteSpace: 'nowrap',
            })}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );

  // Detail/edit: plain block scrollport (no flex). Flex + overflow:auto breaks
  // position:sticky and was pinning Hosted images / tabs while the action bar
  // stuck underneath with a gap. One document scroll → title/tabs leave, only
  // the filename + Export/Edit/Share/Delete row stays at top:0.
  if (detailRoute) {
    return (
      <div
        data-images-scroll="detail"
        style={{
          height: '100%',
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          background: 'var(--bg-app)',
          color: 'var(--text-main)',
          fontFamily: font,
        }}
      >
        {header}
        <Outlet context={ctx} />
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-app)',
        color: 'var(--text-main)',
        fontFamily: font,
        overflow: 'hidden',
      }}
    >
      <div style={{ flexShrink: 0 }}>{header}</div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Outlet context={ctx} />
      </div>
    </div>
  );
}

export default ImagesShell;
