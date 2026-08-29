export type SupportedEditorLanguage =
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'jsonc'
  | 'html'
  | 'css'
  | 'sql'
  | 'markdown'
  | 'shell';

export interface WorkspaceFile {
  id: string;
  name: string;
  path: string;
  language: SupportedEditorLanguage;
  content: string;
  originalContent?: string;
  isDirty?: boolean;
  isReadOnly?: boolean;
  icon?: string;
  category?: 'config' | 'source' | 'data' | 'docs';
}

export interface EditorOptions {
  fontSize?: number;
  lineNumbers?: 'on' | 'off' | 'relative';
  minimap?: boolean;
  wordWrap?: 'on' | 'off' | 'wordWrapColumn';
  readOnly?: boolean;
  tabSize?: number;
  formatOnPaste?: boolean;
  formatOnType?: boolean;
  scrollBeyondLastLine?: boolean;
}

export interface MonacoCursorPosition {
  lineNumber: number;
  column: number;
}
