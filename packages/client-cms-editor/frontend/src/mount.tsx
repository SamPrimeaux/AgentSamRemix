import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CmsEditor from './CmsEditor';
import studioCss from './styles/studio.css?raw';

export type ClientCmsEditorBoot = {
  projectSlug: string;
  pageId?: string | null;
  panel?: 'pages' | 'sections' | 'templates' | 'imports' | 'theme';
  workspaceId?: string;
};

function injectStudioCss() {
  if (document.querySelector('style[data-client-cms-editor]')) return;
  const style = document.createElement('style');
  style.dataset.clientCmsEditor = 'true';
  style.textContent = String(studioCss || '').replace('@import "tailwindcss";', '');
  document.head.appendChild(style);
}

export function mountClientCmsEditor(
  mountEl: HTMLElement,
  boot: ClientCmsEditorBoot,
  onSiteChange?: (slug: string) => void,
) {
  injectStudioCss();
  const panelRaw = boot.panel || 'pages';
  const panel =
    panelRaw === 'sections' ||
    panelRaw === 'templates' ||
    panelRaw === 'imports' ||
    panelRaw === 'theme'
      ? panelRaw
      : 'pages';

  createRoot(mountEl).render(
    <StrictMode>
      <CmsEditor
        projectSlug={boot.projectSlug}
        initialPageId={boot.pageId || null}
        initialPanel={panel}
        workspaceId={boot.workspaceId || ''}
        siteCatalog={[]}
        onSiteChange={(slug) => {
          const url = new URL(window.location.href);
          url.searchParams.set('site', slug);
          window.history.replaceState({}, '', url.toString());
          onSiteChange?.(slug);
        }}
      />
    </StrictMode>,
  );
}
