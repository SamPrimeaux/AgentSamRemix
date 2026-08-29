import type * as Monaco from 'monaco-editor';

/** Extension → Monaco language id (shared by IDE editor + MCP host). */
export const MONACO_LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  py: 'python',
  /** Agent fences sometimes emit `agent_output_*.python` instead of `.py`. */
  python: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  go: 'go',
  rs: 'rust',
  sql: 'sql',
  pgsql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  env: 'plaintext',
  txt: 'plaintext',
  text: 'plaintext',
  tf: 'hcl',
  xml: 'xml',
  wrangler: 'toml',
};

export function monacoLanguageForFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || 'txt';
  return MONACO_LANG_MAP[ext] || 'plaintext';
}

/** Stable Monaco URI for workspace files and virtual buffers. */
export function toMonacoFileUri(path: string, monaco: typeof Monaco): Monaco.Uri {
  const trimmed = path.trim();
  if (/^(?:file:|inmemory:|untitled:)/i.test(trimmed)) {
    return monaco.Uri.parse(trimmed);
  }

  const normalized = trimmed
    .replace(/^file:\/\//, '')
    .replace(/^\/+/, '/')
    .replace(/\\/g, '/');

  return monaco.Uri.parse(`file://${normalized.startsWith('/') ? normalized : `/${normalized}`}`);
}

/** Path key used as Monaco model identity (prefer workspace path over display name). */
export function resolveMonacoModelPath(tab: {
  id: string;
  workspacePath?: string;
  name: string;
}): string {
  const wp = tab.workspacePath?.trim();
  if (wp) return wp;
  if (/^(?:file:|inmemory:|untitled:)/i.test(tab.id)) return tab.id;
  if (!tab.id.includes('/')) {
    return `untitled://agent-sam/${encodeURIComponent(tab.id)}`;
  }
  return tab.id.startsWith('/') ? tab.id : `/${tab.id}`;
}

/**
 * Editors are views; models hold file content, URI, language, and undo history.
 * One model per open file path — switch tabs with editor.setModel(), not setValue().
 */
export function getOrCreateMonacoModel(input: {
  monaco: typeof Monaco;
  path: string;
  content: string;
  language: string;
}): Monaco.editor.ITextModel {
  const uri = toMonacoFileUri(input.path, input.monaco);
  let model = input.monaco.editor.getModel(uri);

  if (!model) {
    model = input.monaco.editor.createModel(input.content ?? '', input.language, uri);
    return model;
  }

  if (model.getLanguageId() !== input.language) {
    input.monaco.editor.setModelLanguage(model, input.language);
  }

  const next = input.content ?? '';
  if (model.getValue() !== next) {
    model.setValue(next);
  }

  return model;
}

export function disposeMonacoModelForPath(monaco: typeof Monaco, path: string): void {
  const model = monaco.editor.getModel(toMonacoFileUri(path, monaco));
  model?.dispose();
}
