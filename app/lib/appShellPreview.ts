/** Editor/browser preview helpers for App shell (Wave 2 E1). */
import type { ActiveFile } from '../types';

export function escapeHtmlForPreview(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Tab-bar Preview is shown for these extensions (inline EditorPreviewPane, not BrowserView). */
export function isRenderablePreviewFilename(name: string): boolean {
  return /\.(html?|svg|md|jsx|tsx)$/i.test(name.trim());
}

export function previewButtonTitle(name: string): string {
  if (/\.(html|htm)$/i.test(name)) return 'Preview HTML';
  if (/\.svg$/i.test(name)) return 'Preview SVG';
  if (/\.md$/i.test(name)) return 'Preview Markdown';
  if (/\.jsx$/i.test(name)) return 'Preview JSX (dev server)';
  if (/\.tsx$/i.test(name)) return 'Preview TSX (dev server)';
  return 'Preview file';
}

/** Preview size thresholds — blob preview above SERVE causes blank/freeze; redirect to PTY. */
export const PREVIEW_WARN_BYTES = 500_000; // 500 KB — warn but still try blob
export const PREVIEW_SERVE_BYTES = 1_500_000; // 1.5 MB — redirect to PTY serve / Vite

/** Shown in the Browser tab address bar instead of a blob: URL when previewing from the editor. */
export function previewAddressBarLabel(file: ActiveFile): string {
  const k = file.r2Key?.trim();
  const b = file.r2Bucket?.trim();
  if (k && b) return `r2://${b}/${k}`;
  const gh = file.githubRepo?.trim();
  const gp = file.githubPath?.trim();
  if (gh && gp) return `github://${gh}/${gp}`;
  const wp = file.workspacePath?.trim();
  if (wp) return `local://${wp}`;
  return `preview:${(file.name || 'buffer').trim() || 'buffer'}`;
}
