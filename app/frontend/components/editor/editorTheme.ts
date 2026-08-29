import type { Monaco } from '@monaco-editor/react';
import { THEME_PALETTES, ThemePalette } from '../../services/themeService';

/**
 * Defines custom Monaco editor themes derived from the app's live theme palettes
 */
export function registerMonacoThemes(monaco: Monaco): void {
  THEME_PALETTES.forEach((palette: ThemePalette) => {
    const isLight = palette.category === 'light';
    const bg = palette.previewColors.bg || '#0c0d10';
    const surface = palette.previewColors.surface || '#181a20';
    const accent = palette.previewColors.accent || '#8ab4f8';
    const text = palette.previewColors.text || '#e8eaed';

    monaco.editor.defineTheme(`agentsam-${palette.id}`, {
      base: isLight ? 'vs' : 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: text.replace('#', '') },
        { token: 'comment', foreground: isLight ? '64748b' : '6b7280', fontStyle: 'italic' },
        { token: 'keyword', foreground: isLight ? '2563eb' : '38bdf8', fontStyle: 'bold' },
        { token: 'string', foreground: isLight ? '16a34a' : '34d399' },
        { token: 'number', foreground: isLight ? 'd97706' : 'fbbf24' },
        { token: 'type', foreground: isLight ? '7c3aed' : 'a78bfa' },
        { token: 'identifier', foreground: text.replace('#', '') },
        { token: 'delimiter', foreground: isLight ? '94a3b8' : '9ca3af' },
        { token: 'tag', foreground: isLight ? 'dc2626' : 'f43f5e' },
        { token: 'attribute.name', foreground: isLight ? '0284c7' : '38bdf8' },
        { token: 'attribute.value', foreground: isLight ? '16a34a' : '4ade80' },
      ],
      colors: {
        'editor.background': bg,
        'editor.foreground': text,
        'editorCursor.foreground': accent,
        'editor.lineHighlightBackground': `${surface}99`,
        'editorLineNumber.foreground': isLight ? '#94a3b8' : '#4b5563',
        'editorLineNumber.activeForeground': accent,
        'editor.selectionBackground': `${accent}33`,
        'editor.inactiveSelectionBackground': `${accent}1a`,
        'editorWidget.background': surface,
        'editorWidget.border': isLight ? '#cbd5e1' : '#374151',
        'editorSuggestWidget.background': surface,
        'editorSuggestWidget.border': isLight ? '#cbd5e1' : '#374151',
        'editorSuggestWidget.selectedBackground': `${accent}26`,
        'minimap.background': bg,
        'scrollbarSlider.background': isLight ? '#cbd5e166' : '#ffffff1a',
        'scrollbarSlider.hoverBackground': isLight ? '#94a3b899' : '#ffffff33',
        'scrollbarSlider.activeBackground': `${accent}66`,
      },
    });
  });
}

/**
 * Returns the matching Monaco theme identifier for the given themeId
 */
export function getMonacoThemeName(themeId: string): string {
  const exists = THEME_PALETTES.some(t => t.id === themeId);
  return exists ? `agentsam-${themeId}` : 'vs-dark';
}
