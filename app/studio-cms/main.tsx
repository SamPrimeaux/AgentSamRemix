import { mountClientCmsEditor } from '@inneranimalmedia/client-cms-editor/frontend';

function readParams() {
  const params = new URLSearchParams(window.location.search);
  const panelRaw = params.get('panel') || 'pages';
  const panel =
    panelRaw === 'sections' ||
    panelRaw === 'templates' ||
    panelRaw === 'imports' ||
    panelRaw === 'theme'
      ? panelRaw
      : 'pages';
  return {
    projectSlug: params.get('site') || params.get('project') || '',
    pageId: params.get('page') || null,
    panel: panel as 'pages' | 'sections' | 'templates' | 'imports' | 'theme',
    workspaceId: params.get('workspace') || '',
  };
}

const mount = document.getElementById('app');
const boot = readParams();

if (mount) {
  mountClientCmsEditor(mount, {
    projectSlug: boot.projectSlug,
    pageId: boot.pageId,
    panel: boot.panel,
    workspaceId: boot.workspaceId,
  }, (slug) => {
    window.parent?.postMessage({ type: 'iam-studio-cms-site', slug }, window.location.origin);
  });
}
