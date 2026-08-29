import React, { useRef } from 'react';
import { DiffEditor, OnMount } from '@monaco-editor/react';
import { SupportedEditorLanguage, EditorOptions } from './editorTypes';
import { registerMonacoThemes, getMonacoThemeName } from './editorTheme';
import { loadStoredSettings } from '../../services/themeService';

export interface MonacoDiffEditorProps {
  original: string;
  modified: string;
  language?: SupportedEditorLanguage;
  height?: string | number;
  width?: string | number;
  options?: EditorOptions;
  themeId?: string;
  className?: string;
}

export const MonacoDiffEditor: React.FC<MonacoDiffEditorProps> = ({
  original,
  modified,
  language = 'typescript',
  height = '100%',
  width = '100%',
  options: userOptions,
  themeId,
  className = '',
}) => {
  const options: EditorOptions = userOptions || {};
  const diffEditorRef = useRef<any>(null);

  const currentThemeId = themeId || loadStoredSettings().themeId || 'midnight-titanium';
  const monacoTheme = getMonacoThemeName(currentThemeId);

  const handleDiffMount: OnMount = (editor, monaco) => {
    diffEditorRef.current = editor;
    registerMonacoThemes(monaco);
    monaco.editor.setTheme(monacoTheme);
  };

  return (
    <div className={`monaco-diff-editor-wrapper relative h-full w-full overflow-hidden ${className}`}>
      <DiffEditor
        height={height}
        width={width}
        language={language === 'jsonc' ? 'json' : language}
        original={original}
        modified={modified}
        theme={monacoTheme}
        onMount={handleDiffMount}
        loading={
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-zinc-950/80 text-xs text-zinc-400 font-mono">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
            <span>Loading Diff View...</span>
          </div>
        }
        options={{
          fontSize: options.fontSize || 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Google Sans Mono', monospace",
          renderSideBySide: true,
          readOnly: true,
          minimap: { enabled: options.minimap ?? false },
          automaticLayout: true,
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          padding: { top: 12, bottom: 12 },
        }}
      />
    </div>
  );
};
