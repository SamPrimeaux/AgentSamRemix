import React, { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { applyMonacoTheme } from '../src/lib/monacoThemes';

const THEME_DEBUG =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('theme_debug');

/**
 * Single source of truth: `data-monaco-theme` + `data-monaco-theme-data` on `<html>`.
 * `parsed.base` is only `vs` | `vs-dark` (inheritance); `themeId` is always e.g. `{slug}-monaco`.
 * Never call `monaco.editor.setTheme('vs-dark')` as the active theme id — only `setTheme(themeId)`.
 */
export function applyMonacoThemeFromDocument(
  monaco: Monaco,
  editor: editor.IStandaloneCodeEditor | null,
): void {
  if (THEME_DEBUG) console.log('[MonacoSurface] applyMonacoTheme called');
  const root = document.documentElement;
  const themeId = root.getAttribute('data-monaco-theme')?.trim() ?? '';
  const themeDataRaw = root.getAttribute('data-monaco-theme-data')?.trim() ?? '';
  const bg = root.getAttribute('data-monaco-bg')?.trim() ?? '';

  if (!themeId || !themeDataRaw) {
    if (THEME_DEBUG) {
      console.table({
        resolvedTheme: themeId || '(missing)',
        hasThemeData: false,
        defineThemeCalled: false,
        setThemeCalled: false,
        note: 'Waiting for data-monaco-theme + data-monaco-theme-data',
      });
    }
    return;
  }

  let parsed: editor.IStandaloneThemeData;
  try {
    parsed = JSON.parse(themeDataRaw) as editor.IStandaloneThemeData;
  } catch {
    console.error('[MonacoSurface] monaco_theme_data parse failed');
    return;
  }

  monaco.editor.defineTheme(themeId, parsed as editor.IStandaloneThemeData);
  monaco.editor.setTheme(themeId);
  // keep in sync with monacoThemes registry

  if (bg && editor) {
    editor.updateOptions({});
  }

  if (THEME_DEBUG) {
    const colors = parsed.colors as Record<string, string> | undefined;
    console.table({
      resolvedTheme: themeId,
      resolvedBg: bg || '(none)',
      hasThemeData: true,
      themeDataBase: parsed.base,
      editorBackground: colors?.['editor.background'],
      defineThemeCalled: true,
      setThemeCalled: true,
    });
  }
}

function readMonacoThemeIdFromDom(): string {
  return document.documentElement.getAttribute('data-monaco-theme')?.trim() || 'vs';
}

export function resolveMonacoTheme(monacoTheme?: string): string {
  const fromProp = monacoTheme?.trim();
  if (fromProp) return fromProp;
  const attr = document.documentElement.getAttribute('data-monaco-theme')?.trim();
  if (attr) return attr;
  /** Never default to `vs-dark` on the HTML root / Editor `theme` prop — wait for CMS attrs or use `vs`. */
  return 'vs';
}

/** Only `data-monaco-bg` / explicit prop — no CSS-token guessing (Monaco mirrors `cms_themes.monaco_bg`). */
export function resolveMonacoBg(monacoBg?: string): string {
  const fromProp = monacoBg?.trim();
  if (fromProp) return fromProp;
  return document.documentElement.getAttribute('data-monaco-bg')?.trim() || '';
}

/** @deprecated Prefer `applyMonacoThemeFromDocument` — kept for older call sites. */
export function applyNonBuiltinMonacoTheme(monaco: Monaco, _resolvedTheme: string, resolvedBg: string): void {
  void _resolvedTheme;
  void resolvedBg;
  applyMonacoThemeFromDocument(monaco, null);
}

export type MonacoSurfaceProps = {
  value: string;
  onChange?: (value: string) => void;
  language?: string;
  height?: string | number;
  readOnly?: boolean;
  monacoTheme?: string;
  monacoBg?: string;
  onMount?: (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => void;
};

export const MonacoSurface: React.FC<MonacoSurfaceProps> = ({
  value,
  onChange,
  language = 'sql',
  height = '100%',
  readOnly = false,
  monacoTheme,
  monacoBg,
  onMount,
}) => {
  const [editorThemeProp, setEditorThemeProp] = useState(readMonacoThemeIdFromDom);
  const onMountRef = useRef(onMount);
  onMountRef.current = onMount;
  const bridgeRef = useRef<{ monaco: Monaco } | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const syncFromDom = useCallback(() => {
    const tid = readMonacoThemeIdFromDom();
    setEditorThemeProp(tid);
    const monaco = bridgeRef.current?.monaco;
    const ed = editorRef.current;
    if (monaco) applyMonacoThemeFromDocument(monaco, ed);
  }, []);

  useEffect(() => {
    window.addEventListener('iam:cms-theme-applied', syncFromDom);
    const mo = new MutationObserver(() => {
      syncFromDom();
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        'data-monaco-theme',
        'data-monaco-theme-data',
        'data-monaco-bg',
        'data-cms-theme',
      ],
    });
    return () => {
      window.removeEventListener('iam:cms-theme-applied', syncFromDom);
      mo.disconnect();
    };
  }, [syncFromDom]);

  void monacoTheme;
  void monacoBg;

  const handleBeforeMount = useCallback((monaco: Monaco) => {
    applyMonacoTheme(monaco);
    applyMonacoThemeFromDocument(monaco, null);
  }, []);

  const handleMount = useCallback(
    (ed: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      bridgeRef.current = { monaco };
      editorRef.current = ed;
      applyMonacoTheme(monaco);
      applyMonacoThemeFromDocument(monaco, ed);
      setEditorThemeProp(readMonacoThemeIdFromDom());
      onMountRef.current?.(ed, monaco);
    },
    [],
  );

  return (
    <Editor
      height={height}
      language={language}
      theme={monacoTheme?.trim() || editorThemeProp}
      value={value}
      onChange={(v) => onChange?.(v ?? '')}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: 'var(--font-mono)',
        scrollBeyondLastLine: false,
      }}
    />
  );
};

export default MonacoSurface;
