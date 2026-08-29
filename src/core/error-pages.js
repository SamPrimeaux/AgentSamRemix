/**
 * Self-contained HTML error pages (no external assets).
 */
export function globeErrorPage({ status = 404, title = 'Page not found', message = '', url = '' } = {}) {
  const displayMsg = message || (status === 404 ? "We couldn't find that page." : 'Something went wrong.');
  const displayUrl = url && url !== '/' ? url : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${status} — Inner Animal Media</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a0f;--text:#e2e8f0;--muted:#64748b;--cyan:#00e5ff;--border:rgba(255,255,255,0.08)}
html,body{height:100%;background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  display:flex;align-items:center;justify-content:center}
.wrap{display:flex;flex-direction:column;align-items:center;
  gap:18px;padding:40px 24px;text-align:center;max-width:420px}
.globe{position:relative;width:88px;height:88px}
.globe svg{position:absolute;inset:0}
.g-outer{animation:spin 16s linear infinite reverse}
.g-inner{animation:spin 8s linear infinite}
@keyframes spin{to{transform:rotate(360deg);transform-origin:center}}
.dots{display:flex;gap:4px}
.dot{width:4px;height:4px;border-radius:50%;background:var(--cyan);opacity:.3;
  animation:dp 1.4s ease-in-out infinite}
.dot:nth-child(2){animation-delay:.2s}
.dot:nth-child(3){animation-delay:.4s}
@keyframes dp{0%,80%,100%{opacity:.15}40%{opacity:.8}}
.code{font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;
  color:var(--cyan);opacity:.65}
h1{font-size:20px;font-weight:700;letter-spacing:-.02em}
.desc{font-size:13px;color:var(--muted);line-height:1.6}
.url{font-size:11px;font-family:monospace;color:var(--muted);opacity:.7;
  word-break:break-all;max-width:100%;margin-top:-4px}
a{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--cyan);
  text-decoration:none;padding:8px 18px;border:1px solid rgba(0,229,255,.2);
  border-radius:8px;margin-top:4px;transition:background .2s}
a:hover{background:rgba(0,229,255,.07)}
</style>
</head>
<body>
<div class="wrap">
  <div class="globe">
    <svg class="g-outer" viewBox="0 0 88 88" fill="none">
      <circle cx="44" cy="44" r="40" stroke="#00e5ff" stroke-width=".6"
        stroke-dasharray="3 7" opacity=".25"/>
      <circle cx="44" cy="44" r="33" stroke="#00e5ff" stroke-width=".4"
        stroke-dasharray="1 9" opacity=".12"/>
    </svg>
    <svg class="g-inner" viewBox="0 0 88 88" fill="none">
      <circle cx="44" cy="44" r="26" stroke="#00e5ff" stroke-width="1.2" opacity=".6"/>
      <ellipse cx="44" cy="44" rx="12" ry="26" stroke="#00e5ff" stroke-width=".8" opacity=".38"/>
      <line x1="18" y1="44" x2="70" y2="44" stroke="#00e5ff" stroke-width=".8" opacity=".38"/>
      <ellipse cx="44" cy="44" rx="26" ry="7" stroke="#00e5ff" stroke-width=".6" opacity=".2"/>
      <ellipse cx="44" cy="44" rx="26" ry="16" stroke="#00e5ff" stroke-width=".5" opacity=".13"/>
      <path d="M32 34 Q37 30 43 32 Q47 34 45 38 Q41 40 36 38Z" fill="#00e5ff" opacity=".13"/>
      <path d="M46 38 Q52 34 56 37 Q58 41 54 43 Q50 43 48 41Z" fill="#00e5ff" opacity=".1"/>
      <path d="M34 46 Q38 44 40 48 Q38 52 34 50Z" fill="#00e5ff" opacity=".08"/>
    </svg>
  </div>
  <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
  <div class="code">${status}</div>
  <h1>${title}</h1>
  <p class="desc">${displayMsg}</p>
  ${displayUrl ? `<div class="url">${displayUrl}</div>` : ''}
  <a href="/">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="m15 18-6-6 6-6"/>
    </svg>
    Back to home
  </a>
</div>
</body>
</html>`;
}
