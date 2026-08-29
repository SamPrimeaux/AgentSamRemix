import {
  SETI_DEFAULT_ICON,
  SETI_FILE_EXTENSIONS,
  SETI_FILE_NAMES,
  SETI_GLYPHS,
  SETI_LANGUAGE_IDS,
  type SetiGlyphDef,
} from './setiIconTheme.generated';

export type { SetiGlyphDef };

/** Monaco / VS Code language id when known (optional hint). */
export type SetiResolveInput = {
  filename: string;
  languageId?: string | null;
};

function basename(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function extChain(name: string): string[] {
  const lower = name.toLowerCase();
  const parts: string[] = [];
  let rest = lower;
  while (rest.includes('.')) {
    const dot = rest.indexOf('.');
    rest = rest.slice(dot + 1);
    if (rest) parts.push(rest);
  }
  return parts;
}

function iconKeyFromExtension(name: string): string | null {
  const chain = extChain(name);
  for (const ext of chain) {
    const hit = SETI_FILE_EXTENSIONS[ext];
    if (hit) return hit;
  }
  return null;
}

/**
 * Resolve Seti icon key for a path (Cursor / VS Code Seti file icon theme parity).
 */
export function resolveSetiIconKey(input: SetiResolveInput): string {
  const name = basename(input.filename || '');
  const lower = name.toLowerCase();

  if (lower && SETI_FILE_NAMES[lower]) return SETI_FILE_NAMES[lower];

  const fromLang = input.languageId?.trim();
  if (fromLang && SETI_LANGUAGE_IDS[fromLang]) return SETI_LANGUAGE_IDS[fromLang];

  const fromExt = iconKeyFromExtension(name);
  if (fromExt) return fromExt;

  return SETI_DEFAULT_ICON;
}

export function getSetiGlyph(iconKey: string): SetiGlyphDef {
  return SETI_GLYPHS[iconKey] ?? SETI_GLYPHS[SETI_DEFAULT_ICON] ?? { char: '\uE023', color: '#d4d7d6' };
}

export function resolveSetiGlyph(input: SetiResolveInput): SetiGlyphDef & { iconKey: string } {
  const iconKey = resolveSetiIconKey(input);
  return { iconKey, ...getSetiGlyph(iconKey) };
}

/** Map file extension to Monaco language id (for icon hints). */
export function monacoLanguageIdFromFilename(filename: string): string | undefined {
  const chain = extChain(basename(filename));
  const ext = chain[0];
  if (!ext) return undefined;
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    jsonc: 'jsonc',
    md: 'markdown',
    markdown: 'markdown',
    mdx: 'markdown',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    sh: 'shellscript',
    bash: 'shellscript',
    zsh: 'shellscript',
    py: 'python',
    python: 'python',
    go: 'go',
    rs: 'rust',
    sql: 'sql',
    yml: 'yaml',
    yaml: 'yaml',
    xml: 'xml',
    vue: 'vue',
    svelte: 'svelte',
    graphql: 'graphql',
    gql: 'graphql',
    wasm: 'wasm',
    dockerfile: 'dockerfile',
    tf: 'terraform',
    toml: 'toml',
    wrangler: 'toml',
  };
  return map[ext];
}
