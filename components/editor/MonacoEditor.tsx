import React, { useCallback, useRef } from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
import { SupportedEditorLanguage, EditorOptions, MonacoCursorPosition } from './editorTypes';
import { registerMonacoThemes, getMonacoThemeName } from './editorTheme';
import { loadStoredSettings } from '../../services/themeService';

export interface MonacoEditorProps {
  value: string;
  language?: SupportedEditorLanguage;
  onChange?: (value: string) => void;
  onSave?: (value: string) => void;
  onCursorChange?: (pos: MonacoCursorPosition) => void;
  readOnly?: boolean;
  height?: string | number;
  width?: string | number;
  options?: EditorOptions;
  themeId?: string;
  className?: string;
}

export const MonacoEditor: React.FC<MonacoEditorProps> = ({
  value,
  language = 'typescript',
  onChange,
  onSave,
  onCursorChange,
  readOnly = false,
  height = '100%',
  width = '100%',
  options: userOptions,
  themeId,
  className = '',
}) => {
  const options: EditorOptions = userOptions || {};
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  // If themeId not passed, pull from stored settings
  const currentThemeId = themeId || loadStoredSettings().themeId || 'midnight-titanium';
  const monacoTheme = getMonacoThemeName(currentThemeId);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    registerMonacoThemes(monaco);
    monaco.editor.setTheme(monacoTheme);

    // Track cursor changes
    if (onCursorChange) {
      editor.onDidChangeCursorPosition(e => {
        onCursorChange({
          lineNumber: e.position.lineNumber,
          column: e.position.column,
        });
      });
    }

    // Ctrl+S / Cmd+S save shortcut
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const currentVal = editor.getValue();
      if (onSave) onSave(currentVal);
    });
  };

  const handleEditorChange: OnChange = (val) => {
    if (onChange) {
      onChange(val ?? '');
    }
  };

  return (
    <div className={`monaco-editor-wrapper relative h-full w-full overflow-hidden ${className}`}>
      <Editor
        height={height}
        width={width}
        language={language === 'jsonc' ? 'json' : language}
        value={value}
        theme={monacoTheme}
        onChange={handleEditorChange}
        onMount={handleEditorDidMount}
        loading={
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-zinc-950/80 text-xs text-zinc-400 font-mono">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
            <span>Mounting Monaco Editor...</span>
          </div>
        }
        options={{
          fontSize: options.fontSize || 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Google Sans Mono', monospace",
          fontLigatures: true,
          lineNumbers: options.lineNumbers || 'on',
          minimap: { enabled: options.minimap ?? false },
          wordWrap: options.wordWrap || 'on',
          readOnly: readOnly || options.readOnly || false,
          tabSize: options.tabSize || 2,
          automaticLayout: true,
          scrollBeyondLastLine: options.scrollBeyondLastLine ?? false,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          renderLineHighlight: 'all',
          padding: { top: 12, bottom: 12 },
          lineDecorationsWidth: 6,
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          renderWhitespace: 'selection',
        }}
      />
    </div>
  );
};
