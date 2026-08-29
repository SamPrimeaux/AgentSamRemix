/**
 * VS Code–style editor semantic highlighting for Monaco (TypeScript / JavaScript).
 *
 * Monaco's TS language mode does not register a DocumentSemanticTokensProvider.
 * We compute 2020 classifications via the `typescript` package and feed Monaco
 * semantic tokens. Editor option: 'semanticHighlighting.enabled' = true.
 */
import type * as Monaco from 'monaco-editor';

const CONTENT_LENGTH_LIMIT = 100_000;

/** Matches VS Code typescript-language-features legend / encoding. */
const TOKEN_TYPES = [
  'class',
  'enum',
  'interface',
  'namespace',
  'typeParameter',
  'type',
  'parameter',
  'variable',
  'enumMember',
  'property',
  'function',
  'method',
] as const;

const TOKEN_MODIFIERS = [
  'declaration',
  'static',
  'async',
  'readonly',
  'defaultLibrary',
  'local',
] as const;

const TYPE_OFFSET = 8;
const MODIFIER_MASK = 255;

let configured = false;
let tsModulePromise: Promise<typeof import('typescript')> | null = null;

function loadTypescript() {
  if (!tsModulePromise) {
    tsModulePromise = import('typescript');
  }
  return tsModulePromise;
}

function getTokenTypeFromClassification(tsClassification: number): number | undefined {
  if (tsClassification > MODIFIER_MASK) {
    return (tsClassification >> TYPE_OFFSET) - 1;
  }
  return undefined;
}

function getTokenModifierFromClassification(tsClassification: number): number {
  return tsClassification & MODIFIER_MASK;
}

/** Dark+/hc-friendly semantic token colors (TextMate-mapped + extras). */
export const IAM_SEMANTIC_TOKEN_THEME_RULES: Monaco.editor.ITokenThemeRule[] = [
  { token: 'class', foreground: '4EC9B0' },
  { token: 'enum', foreground: '4EC9B0' },
  { token: 'interface', foreground: '4EC9B0' },
  { token: 'namespace', foreground: '4EC9B0' },
  { token: 'typeParameter', foreground: '4EC9B0' },
  { token: 'type', foreground: '4EC9B0' },
  { token: 'parameter', foreground: '9CDCFE' },
  { token: 'variable', foreground: '9CDCFE' },
  { token: 'enumMember', foreground: '4FC1FF' },
  { token: 'property', foreground: '9CDCFE' },
  { token: 'function', foreground: 'DCDCAA' },
  { token: 'method', foreground: 'DCDCAA' },
  { token: 'parameter.declaration', foreground: '9CDCFE', fontStyle: 'italic' },
  { token: 'variable.declaration', foreground: '9CDCFE' },
  { token: 'function.declaration', foreground: 'DCDCAA', fontStyle: 'bold' },
  { token: 'method.declaration', foreground: 'DCDCAA', fontStyle: 'bold' },
  { token: 'variable.readonly', foreground: '4FC1FF' },
  { token: 'property.readonly', foreground: '4FC1FF' },
  { token: 'variable.defaultLibrary', foreground: '4FC1FF' },
  { token: 'class.defaultLibrary', foreground: '4EC9B0' },
];

function configureTsJsDefaults(monaco: typeof Monaco): void {
  const ts = monaco.languages.typescript;
  if (!ts?.typescriptDefaults || !ts?.javascriptDefaults) return;

  const compilerOptions: Monaco.languages.typescript.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    allowNonTsExtensions: true,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    module: ts.ModuleKind.ESNext,
    noEmit: true,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    checkJs: false,
    skipLibCheck: true,
    isolatedModules: true,
  };

  ts.typescriptDefaults.setCompilerOptions(compilerOptions);
  ts.javascriptDefaults.setCompilerOptions({
    ...compilerOptions,
    allowJs: true,
    checkJs: false,
  });
  ts.typescriptDefaults.setEagerModelSync(true);
  ts.javascriptDefaults.setEagerModelSync(true);
  ts.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  ts.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });
}

type ClassSpan = { offset: number; length: number; classification: number };

const classifyCache = new WeakMap<
  Monaco.editor.ITextModel,
  { versionId: number; spans: ClassSpan[] | null; promise: Promise<ClassSpan[] | null> }
>();

function scriptFileNameForModel(model: Monaco.editor.ITextModel): string {
  const lang = model.getLanguageId();
  const path = model.uri.path.toLowerCase();
  if (lang === 'javascript' || path.endsWith('.js') || path.endsWith('.jsx')) {
    return path.endsWith('.jsx')
      ? 'file:///inmemory/model.jsx'
      : 'file:///inmemory/model.js';
  }
  if (path.endsWith('.tsx')) return 'file:///inmemory/model.tsx';
  return 'file:///inmemory/model.ts';
}

async function classifyModelUncached(
  model: Monaco.editor.ITextModel,
): Promise<ClassSpan[] | null> {
  const text = model.getValue();
  if (!text || text.length > CONTENT_LENGTH_LIMIT) return null;

  const ts = await loadTypescript();
  const fileName = scriptFileNameForModel(model);

  const compilerOptions: import('typescript').CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    isolatedModules: true,
  };

  const host: import('typescript').LanguageServiceHost = {
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => String(model.getVersionId()),
    getScriptSnapshot: (name) => {
      if (name === fileName) return ts.ScriptSnapshot.fromString(text);
      return undefined;
    },
    getCurrentDirectory: () => '/',
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFileName(opts),
    fileExists: (name) => name === fileName,
    readFile: (name) => (name === fileName ? text : undefined),
    directoryExists: () => true,
    getDirectories: () => [],
  };

  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  try {
    const result = service.getEncodedSemanticClassifications(
      fileName,
      { start: 0, length: text.length },
      ts.SemanticClassificationFormat.TwentyTwenty,
    );
    const spans = result?.spans;
    if (!Array.isArray(spans) || !spans.length) return [];
    const out: ClassSpan[] = [];
    for (let i = 0; i + 2 < spans.length; ) {
      out.push({
        offset: spans[i++]!,
        length: spans[i++]!,
        classification: spans[i++]!,
      });
    }
    return out;
  } finally {
    service.dispose();
  }
}

function classifyModel(model: Monaco.editor.ITextModel): Promise<ClassSpan[] | null> {
  const versionId = model.getVersionId();
  const hit = classifyCache.get(model);
  if (hit && hit.versionId === versionId) return hit.promise;

  const promise = classifyModelUncached(model).then((spans) => {
    const cur = classifyCache.get(model);
    if (cur && cur.promise === promise) cur.spans = spans;
    return spans;
  });
  classifyCache.set(model, { versionId, spans: null, promise });
  return promise;
}

function encodeSemanticTokens(
  model: Monaco.editor.ITextModel,
  spans: ClassSpan[],
): Uint32Array {
  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;

  for (const span of spans) {
    const tokenType = getTokenTypeFromClassification(span.classification);
    if (tokenType === undefined || tokenType < 0 || tokenType >= TOKEN_TYPES.length) {
      continue;
    }
    const tokenModifiers = getTokenModifierFromClassification(span.classification);
    const start = model.getPositionAt(span.offset);
    const end = model.getPositionAt(span.offset + span.length);

    for (let line = start.lineNumber; line <= end.lineNumber; line++) {
      const lineText = model.getLineContent(line);
      const startCharacter = line === start.lineNumber ? start.column - 1 : 0;
      const endCharacter =
        line === end.lineNumber ? end.column - 1 : lineText.length;
      const length = Math.max(0, endCharacter - startCharacter);
      if (length === 0) continue;

      const deltaLine = line - 1 - prevLine;
      const deltaStart = deltaLine === 0 ? startCharacter - prevChar : startCharacter;
      data.push(deltaLine, deltaStart, length, tokenType, tokenModifiers);
      prevLine = line - 1;
      prevChar = startCharacter;
    }
  }

  return new Uint32Array(data);
}

function registerSemanticTokensProvider(
  monaco: typeof Monaco,
  languageId: string,
): Monaco.IDisposable {
  const legend: Monaco.languages.SemanticTokensLegend = {
    tokenTypes: [...TOKEN_TYPES],
    tokenModifiers: [...TOKEN_MODIFIERS],
  };

  return monaco.languages.registerDocumentSemanticTokensProvider(languageId, {
    getLegend: () => legend,
    provideDocumentSemanticTokens: async (model) => {
      try {
        const spans = await classifyModel(model);
        if (!spans) return null;
        return { data: encodeSemanticTokens(model, spans) };
      } catch (e) {
        console.warn('[monaco-semantic]', languageId, (e as Error)?.message ?? e);
        return null;
      }
    },
    releaseDocumentSemanticTokens: () => {
      /* no-op — we don't keep result ids */
    },
  });
}

/**
 * One-time Monaco setup: TS/JS defaults + semantic token providers.
 * Call after monaco loader.init().
 */
export function configureMonacoSemanticHighlighting(monaco: typeof Monaco): void {
  if (!monaco || configured) return;
  configured = true;

  try {
    configureTsJsDefaults(monaco);
  } catch (e) {
    console.warn('[monaco-semantic] defaults', (e as Error)?.message ?? e);
  }

  // Monaco maps .ts/.tsx → typescript and .js/.jsx → javascript (no separate react ids).
  for (const lang of ['typescript', 'javascript'] as const) {
    try {
      registerSemanticTokensProvider(monaco, lang);
    } catch (e) {
      console.warn('[monaco-semantic] provider', lang, (e as Error)?.message ?? e);
    }
  }
}

/**
 * F1: Developer: Inspect Editor Tokens and Scopes (semantic + language id).
 */
export function attachMonacoTokenInspector(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
): Monaco.IDisposable {
  return editor.addAction({
    id: 'iam.inspectEditorTokens',
    label: 'Developer: Inspect Editor Tokens and Scopes',
    precondition: undefined,
    keybindings: [],
    contextMenuGroupId: '1_modification',
    contextMenuOrder: 9,
    run: async (ed) => {
      const model = ed.getModel();
      const pos = ed.getPosition();
      if (!model || !pos) return;
      const offset = model.getOffsetAt(pos);
      const word = model.getWordAtPosition(pos);
      let semanticLine = 'semantic token: (none / not TS·JS or still computing)';
      try {
        const spans = await classifyModel(model);
        const hit = spans?.find((s) => offset >= s.offset && offset < s.offset + s.length);
        if (hit) {
          const typeIdx = getTokenTypeFromClassification(hit.classification);
          const mods = getTokenModifierFromClassification(hit.classification);
          const typeName =
            typeIdx != null && typeIdx >= 0 && typeIdx < TOKEN_TYPES.length
              ? TOKEN_TYPES[typeIdx]
              : `type#${typeIdx}`;
          const modNames = TOKEN_MODIFIERS.filter((_, i) => (mods & (1 << i)) !== 0);
          semanticLine = `semantic token type: ${typeName}${
            modNames.length ? `  modifiers: ${modNames.join(', ')}` : ''
          }`;
        }
      } catch {
        /* ignore */
      }

      const msg = [
        `language: ${model.getLanguageId()}`,
        `position: L${pos.lineNumber}:C${pos.column}`,
        `word: ${word?.word ?? '—'}`,
        semanticLine,
        `semanticHighlighting.enabled: true`,
      ].join('\n');

      // Prefer Monaco's built-in message; fall back to console.
      try {
        const op = ed.getContribution?.('editor.contrib.quickInput') as
          | { pick?: unknown }
          | null;
        void op;
      } catch {
        /* ignore */
      }
      console.info('[Inspect Editor Tokens]\n' + msg);
      window.alert(msg);
    },
  });
}
