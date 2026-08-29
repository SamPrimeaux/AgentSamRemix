import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { IAM_SEMANTIC_TOKEN_THEME_RULES } from './monacoSemanticHighlighting';

/** Default IDE code + diff theme (Monaco High Contrast Black + visible diff fills). */
export const IAM_HC_BLACK_THEME_ID = 'iam-hc-black';

/**
 * Syntax from built-in `hc-black`; colors tuned for black editor + side-by-side diff
 * (green insert / red delete fills like the Monaco demo).
 * Semantic token rules enrich TS/JS when 'semanticHighlighting.enabled' is true.
 */
export const IAM_HC_BLACK_THEME: editor.IStandaloneThemeData = {
  base: 'hc-black',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: '6FC3DF' },
    { token: 'keyword.control', foreground: '6FC3DF' },
    { token: 'storage.type', foreground: '4EC9B0' },
    { token: 'type', foreground: '4EC9B0' },
    { token: 'type.identifier', foreground: '4EC9B0' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'string.sql', foreground: 'CE9178' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'constant', foreground: '569CD6' },
    { token: 'function', foreground: 'DCDCAA' },
    { token: 'variable', foreground: '9CDCFE' },
    { token: 'tag', foreground: '6FC3DF' },
    { token: 'attribute.name', foreground: '9CDCFE' },
    { token: 'delimiter', foreground: 'D4D4D4' },
    ...IAM_SEMANTIC_TOKEN_THEME_RULES,
  ],
  colors: {
    'editor.background': '#000000',
    'editor.foreground': '#FFFFFF',
    'editor.lineHighlightBackground': '#0a0a0a',
    'editor.selectionBackground': '#264F78',
    'editor.inactiveSelectionBackground': '#3A3D41',
    'editorCursor.foreground': '#FFFFFF',
    'editorLineNumber.foreground': '#858585',
    'editorLineNumber.activeForeground': '#C6C6C6',
    'editorIndentGuide.background1': '#404040',
    'editorIndentGuide.activeBackground1': '#707070',
    'editorWidget.background': '#0a0a0a',
    'editorWidget.border': '#6FC3DF',
    'scrollbarSlider.background': '#79797966',
    'scrollbarSlider.hoverBackground': '#646464b3',
    'minimap.background': '#000000',
    'diffEditor.border': '#6FC3DF',
    'diffEditor.insertedTextBackground': '#9ccc2c55',
    'diffEditor.removedTextBackground': '#ff000055',
    'diffEditor.insertedLineBackground': '#587c0c4d',
    'diffEditor.removedLineBackground': '#9f10104d',
    'diffEditor.insertedTextBorder': '#33ff2eaa',
    'diffEditor.removedTextBorder': '#ff008faa',
    'diffEditor.diagonalFill': '#ffffff22',
    'diffEditor.unchangedRegionBackground': '#0a0a0a',
    'diffEditor.unchangedCodeBackground': '#74747429',
    'diffEditorOverview.insertedForeground': '#73c991',
    'diffEditorOverview.removedForeground': '#f14c4c',
    'editorOverviewRuler.addedForeground': '#73c991',
    'editorOverviewRuler.deletedForeground': '#f14c4c',
    'editorOverviewRuler.modifiedForeground': '#e2c08d',
  },
};

const REGISTERED = new Set<string>();

export function registerIamMonacoThemes(monaco: Monaco): void {
  if (!REGISTERED.has(IAM_HC_BLACK_THEME_ID)) {
    monaco.editor.defineTheme(IAM_HC_BLACK_THEME_ID, IAM_HC_BLACK_THEME);
    REGISTERED.add(IAM_HC_BLACK_THEME_ID);
  }
}

/** Prefer CMS `data-monaco-theme` when theme JSON is on `<html>`; else high-contrast default. */
export function resolveMonacoThemeId(): string {
  if (typeof document === 'undefined') return IAM_HC_BLACK_THEME_ID;
  const root = document.documentElement;
  const themeId = root.getAttribute('data-monaco-theme')?.trim() ?? '';
  const themeData = root.getAttribute('data-monaco-theme-data')?.trim() ?? '';
  if (themeId && themeData) return themeId;
  return IAM_HC_BLACK_THEME_ID;
}

function applyCmsMonacoThemeFromDom(monaco: Monaco): string | null {
  if (typeof document === 'undefined') return null;
  const root = document.documentElement;
  const themeId = root.getAttribute('data-monaco-theme')?.trim() ?? '';
  const themeDataRaw = root.getAttribute('data-monaco-theme-data')?.trim() ?? '';
  if (!themeId || !themeDataRaw) return null;
  try {
    const parsed = JSON.parse(themeDataRaw) as editor.IStandaloneThemeData;
    monaco.editor.defineTheme(themeId, parsed);
    REGISTERED.add(themeId);
    monaco.editor.setTheme(themeId);
    return themeId;
  } catch {
    return null;
  }
}

export function applyMonacoTheme(monaco: Monaco, themeId?: string): string {
  registerIamMonacoThemes(monaco);
  const cms = applyCmsMonacoThemeFromDom(monaco);
  if (cms) return cms;
  const id = themeId?.trim() || IAM_HC_BLACK_THEME_ID;
  monaco.editor.setTheme(id);
  return id;
}

const MONO_FONT =
  '"JetBrains Mono", "Fira Code", Menlo, Monaco, "Courier New", monospace';

export function buildStandaloneEditorOptions(
  isLarge: boolean,
  readOnly: boolean,
): editor.IStandaloneEditorConstructionOptions {
  return {
    minimap: { enabled: !isLarge, renderCharacters: false, scale: 0.75 },
    fontSize: 13,
    fontFamily: MONO_FONT,
    fontLigatures: true,
    lineHeight: 22,
    padding: { top: 12 },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    renderLineHighlight: 'line',
    bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
    guides: { bracketPairs: true, indentation: true },
    wordWrap: 'off',
    renderWhitespace: 'none',
    tabSize: 2,
    insertSpaces: true,
    folding: !isLarge,
    largeFileOptimizations: isLarge,
    maxTokenizationLineLength: isLarge ? 400 : 10_000,
    colorDecorators: true,
    /** VS Code editor.semanticHighlighting.enabled — force on for all themes. */
    'semanticHighlighting.enabled': true,
    /** Gutter dots for TODO-Highlight annotations. */
    glyphMargin: true,
    suggest: { showSnippets: true },
    quickSuggestions: { other: true, comments: true, strings: false },
    formatOnPaste: true,
    formatOnType: false,
    readOnly,
    automaticLayout: true,
  };
}

/** Side-by-side diff editor — matches Monaco demo behavior. */
export function buildDiffEditorOptions(
  opts: { isLarge?: boolean; modifiedEditable?: boolean } = {},
): editor.IDiffEditorConstructionOptions {
  const isLarge = opts.isLarge ?? false;
  const modifiedEditable = opts.modifiedEditable ?? false;
  return {
    ...buildStandaloneEditorOptions(isLarge, !modifiedEditable),
    readOnly: !modifiedEditable,
    originalEditable: false,
    modifiedEditable,
    renderSideBySide: true,
    enableSplitViewResizing: true,
    useInlineViewWhenSpaceIsLimited: true,
    renderOverviewRuler: true,
    ignoreTrimWhitespace: false,
    renderMarginRevertIcon: modifiedEditable,
    diffCodeLens: false,
    diffWordWrap: 'off',
    hideUnchangedRegions: { enabled: false },
    automaticLayout: true,
  };
}
