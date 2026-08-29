/** Build sandboxed HTML for editor srcDoc preview (static HTML / MD / SVG). */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Injected into HTML previews so relative links cannot resolve against the parent
 * dashboard origin (srcdoc inherits the parent base URL without an explicit <base>).
 * Clicks that would navigate away are blocked; absolute http(s) open in a new tab.
 */
const PREVIEW_NAV_GUARD = `<base href="about:srcdoc"/><script>(function(){document.addEventListener("click",function(e){var t=e.target;if(!t||!t.closest)return;var a=t.closest("a");if(!a)return;var href=a.getAttribute("href");if(href==null||href===""||href.charAt(0)==="#")return;e.preventDefault();e.stopPropagation();if(/^https?:\\/\\//i.test(href)||href.slice(0,2)==="//"){try{window.open(href.indexOf("//")==0?"https:"+href:href,"_blank","noopener,noreferrer");}catch(_){}}},{capture:true});})();</script>`;

function injectPreviewNavGuard(html: string): string {
  const raw = String(html || '');
  if (!raw.trim()) return raw;
  // Idempotent: already guarded by our about:srcdoc base + click capture.
  if (/href=["']about:srcdoc["']/i.test(raw) && /closest\(["']a["']\)/i.test(raw)) {
    return raw;
  }
  if (/<head[\s>]/i.test(raw)) {
    return raw.replace(/<head([^>]*)>/i, `<head$1>${PREVIEW_NAV_GUARD}`);
  }
  if (/<html[\s>]/i.test(raw)) {
    return raw.replace(/<html([^>]*)>/i, `<html$1><head>${PREVIEW_NAV_GUARD}</head>`);
  }
  return `<!DOCTYPE html><html><head>${PREVIEW_NAV_GUARD}</head><body>${raw}</body></html>`;
}

export function buildPreviewSrcDoc(fileName: string, content: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const name = escapeHtml(fileName.trim() || 'preview');

  if (ext === 'svg') {
    return content.trim();
  }

  if (ext === 'md') {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${name}</title>${PREVIEW_NAV_GUARD}<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:52rem;margin:1rem auto;padding:0 1rem;line-height:1.5}</style></head><body><pre style="white-space:pre-wrap;font-family:Menlo,Monaco,monospace;font-size:13px">${escapeHtml(content)}</pre></body></html>`;
  }

  if (ext === 'html' || ext === 'htm') {
    return injectPreviewNavGuard(content);
  }

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${name}</title>${PREVIEW_NAV_GUARD}</head><body><pre>${escapeHtml(content)}</pre></body></html>`;
}

export function previewSrcDocMime(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'svg') return 'image/svg+xml';
  return 'text/html; charset=utf-8';
}

/** Sandbox for agent/editor HTML srcdoc — scripts ok; opaque origin (no session cookies). */
export const EDITOR_HTML_PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-popups';
