/**
 * Monaco TODO-Highlight — VS Code-style annotation decorations + F1 actions.
 * Commands (Command Palette / F1):
 *   - TODO-Highlight: List highlighted annotations
 *   - TODO-Highlight: Toggle highlight
 */
import type * as Monaco from 'monaco-editor';

const STORAGE_KEY = 'iam.monaco.todoHighlight.enabled';
const TAG_RE = /\b(TODO|FIXME|HACK|XXX|BUG|NOTE)(?:\b|[:\s])/gi;

export type TodoAnnotation = {
  tag: string;
  text: string;
  lineNumber: number;
  startColumn: number;
  endColumn: number;
};

type TodoHighlightHandle = {
  dispose: () => void;
  refresh: () => void;
  setEnabled: (on: boolean) => void;
  isEnabled: () => boolean;
  list: () => TodoAnnotation[];
};

function readEnabled(): boolean {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v === null) return true;
    return v !== '0' && v !== 'false';
  } catch {
    return true;
  }
}

function writeEnabled(on: boolean): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('iam-monaco-todo-highlight-css')) return;
  const style = document.createElement('style');
  style.id = 'iam-monaco-todo-highlight-css';
  style.textContent = `
.iam-todo-hl-todo { background: rgba(255, 193, 7, 0.28); border-bottom: 2px solid #ffc107; }
.iam-todo-hl-fixme { background: rgba(244, 67, 54, 0.28); border-bottom: 2px solid #f44336; }
.iam-todo-hl-hack { background: rgba(255, 152, 0, 0.28); border-bottom: 2px solid #ff9800; }
.iam-todo-hl-xxx { background: rgba(156, 39, 176, 0.28); border-bottom: 2px solid #9c27b0; }
.iam-todo-hl-bug { background: rgba(244, 67, 54, 0.35); border-bottom: 2px solid #e53935; }
.iam-todo-hl-note { background: rgba(33, 150, 243, 0.22); border-bottom: 2px solid #2196f3; }
.iam-todo-hl-glyph-todo::after,
.iam-todo-hl-glyph-fixme::after,
.iam-todo-hl-glyph-hack::after,
.iam-todo-hl-glyph-xxx::after,
.iam-todo-hl-glyph-bug::after,
.iam-todo-hl-glyph-note::after {
  content: '';
  display: block;
  width: 6px;
  height: 6px;
  margin: 6px 0 0 4px;
  border-radius: 50%;
}
.iam-todo-hl-glyph-todo::after { background: #ffc107; }
.iam-todo-hl-glyph-fixme::after { background: #f44336; }
.iam-todo-hl-glyph-hack::after { background: #ff9800; }
.iam-todo-hl-glyph-xxx::after { background: #9c27b0; }
.iam-todo-hl-glyph-bug::after { background: #e53935; }
.iam-todo-hl-glyph-note::after { background: #2196f3; }
.iam-todo-list-panel {
  position: absolute; z-index: 40; top: 40px; right: 16px; width: min(420px, 92%);
  max-height: min(360px, 50vh); overflow: auto; border-radius: 8px;
  background: var(--panel-bg, #1e1e1e); color: var(--panel-fg, #e0e0e0);
  border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 12px 40px rgba(0,0,0,0.45);
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.iam-todo-list-panel header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); font-weight: 600;
}
.iam-todo-list-panel button.close {
  background: transparent; border: 0; color: inherit; cursor: pointer; font-size: 14px;
}
.iam-todo-list-panel ul { list-style: none; margin: 0; padding: 4px 0; }
.iam-todo-list-panel li {
  display: flex; gap: 8px; padding: 6px 10px; cursor: pointer;
}
.iam-todo-list-panel li:hover { background: rgba(255,255,255,0.06); }
.iam-todo-list-panel .tag {
  flex: 0 0 auto; min-width: 52px; font-weight: 700; opacity: 0.9;
}
.iam-todo-list-panel .empty { padding: 16px 10px; opacity: 0.7; }
`;
  document.head.appendChild(style);
}

function classForTag(tag: string): { inline: string; glyph: string } {
  const t = tag.toUpperCase();
  const key = ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'NOTE'].includes(t) ? t.toLowerCase() : 'todo';
  return {
    inline: `iam-todo-hl-${key}`,
    glyph: `iam-todo-hl-glyph-${key}`,
  };
}

export function scanTodoAnnotations(model: Monaco.editor.ITextModel | null): TodoAnnotation[] {
  if (!model) return [];
  const out: TodoAnnotation[] = [];
  const lineCount = model.getLineCount();
  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
    const line = model.getLineContent(lineNumber);
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(line)) != null) {
      const tag = String(m[1] || '').toUpperCase();
      const startColumn = (m.index ?? 0) + 1;
      const endColumn = Math.min(line.length + 1, startColumn + tag.length);
      const text = line.slice(m.index).trim().slice(0, 160);
      out.push({ tag, text, lineNumber, startColumn, endColumn });
    }
  }
  return out;
}

function showAnnotationList(
  host: HTMLElement,
  annotations: TodoAnnotation[],
  onPick: (a: TodoAnnotation) => void,
): () => void {
  ensureStyles();
  const existing = host.querySelector('.iam-todo-list-panel');
  existing?.remove();

  const panel = document.createElement('div');
  panel.className = 'iam-todo-list-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'TODO highlighted annotations');

  const header = document.createElement('header');
  header.innerHTML = `<span>TODO annotations (${annotations.length})</span>`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  header.appendChild(closeBtn);
  panel.appendChild(header);

  if (!annotations.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No TODO / FIXME / HACK / NOTE annotations in this file.';
    panel.appendChild(empty);
  } else {
    const ul = document.createElement('ul');
    for (const a of annotations) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="tag">${a.tag}</span><span class="text">L${a.lineNumber}: ${escapeHtml(a.text)}</span>`;
      li.addEventListener('click', () => {
        onPick(a);
        panel.remove();
      });
      ul.appendChild(li);
    }
    panel.appendChild(ul);
  }

  const close = () => panel.remove();
  closeBtn.addEventListener('click', close);
  host.appendChild(panel);
  return close;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Attach TODO decorations + Command Palette actions to a standalone Monaco editor.
 */
export function attachMonacoTodoHighlight(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
): TodoHighlightHandle {
  ensureStyles();
  let enabled = readEnabled();
  let decorationIds: string[] = [];
  let contentSub: Monaco.IDisposable | null = null;
  let modelSub: Monaco.IDisposable | null = null;
  let closeList: (() => void) | null = null;

  const clearDecorations = () => {
    decorationIds = editor.deltaDecorations(decorationIds, []);
  };

  const apply = () => {
    const model = editor.getModel();
    if (!enabled || !model) {
      clearDecorations();
      return;
    }
    const ann = scanTodoAnnotations(model);
    decorationIds = editor.deltaDecorations(
      decorationIds,
      ann.map((a) => {
        const cls = classForTag(a.tag);
        return {
          range: new monaco.Range(a.lineNumber, a.startColumn, a.lineNumber, a.endColumn),
          options: {
            inlineClassName: cls.inline,
            glyphMarginClassName: cls.glyph,
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            overviewRuler: {
              color: a.tag === 'FIXME' || a.tag === 'BUG' ? '#f44336' : '#ffc107',
              position: monaco.editor.OverviewRulerLane.Right,
            },
            minimap: {
              color: a.tag === 'FIXME' || a.tag === 'BUG' ? '#f44336' : '#ffc107',
              position: monaco.editor.MinimapPosition.Inline,
            },
            hoverMessage: { value: `**${a.tag}** — ${a.text}` },
          },
        };
      }),
    );
  };

  const bindModel = () => {
    contentSub?.dispose();
    contentSub = editor.onDidChangeModelContent(() => apply());
    apply();
  };

  modelSub = editor.onDidChangeModel(() => bindModel());
  bindModel();

  const listAction = editor.addAction({
    id: 'todo-highlight.listAnnotations',
    label: 'TODO-Highlight: List highlighted annotations',
    precondition: undefined,
    keybindings: [],
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.6,
    run: (ed) => {
      const host = ed.getDomNode()?.parentElement;
      if (!host) return;
      closeList?.();
      const ann = scanTodoAnnotations(ed.getModel());
      closeList = showAnnotationList(host, ann, (a) => {
        ed.revealLineInCenter(a.lineNumber);
        ed.setPosition({ lineNumber: a.lineNumber, column: a.startColumn });
        ed.focus();
      });
    },
  });

  const toggleAction = editor.addAction({
    id: 'todo-highlight.toggleHighlight',
    label: 'TODO-Highlight: Toggle highlight',
    precondition: undefined,
    keybindings: [],
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.7,
    run: () => {
      enabled = !enabled;
      writeEnabled(enabled);
      if (!enabled) {
        clearDecorations();
        closeList?.();
        closeList = null;
      } else {
        apply();
      }
    },
  });

  const onWinToggle = () => {
    enabled = !enabled;
    writeEnabled(enabled);
    if (!enabled) clearDecorations();
    else apply();
  };
  const onWinList = () => {
    void editor.getAction('todo-highlight.listAnnotations')?.run();
  };
  window.addEventListener('iam-todo-highlight-toggle', onWinToggle);
  window.addEventListener('iam-todo-highlight-list', onWinList);

  return {
    refresh: apply,
    setEnabled: (on) => {
      enabled = !!on;
      writeEnabled(enabled);
      if (!enabled) clearDecorations();
      else apply();
    },
    isEnabled: () => enabled,
    list: () => scanTodoAnnotations(editor.getModel()),
    dispose: () => {
      window.removeEventListener('iam-todo-highlight-toggle', onWinToggle);
      window.removeEventListener('iam-todo-highlight-list', onWinList);
      contentSub?.dispose();
      modelSub?.dispose();
      listAction.dispose();
      toggleAction.dispose();
      clearDecorations();
      closeList?.();
    },
  };
}
