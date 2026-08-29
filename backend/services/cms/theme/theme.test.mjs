import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildActiveThemeApiPayload,
  mergeAgentDashboardIdeTokens,
  parseCmsThemeConfig,
  variablesFromCmsThemeConfig,
} from './active.js';
import { buildCanonicalThemeTokens } from './tokens.js';
import { buildConfigFromPalette, normalizeThemeSlug } from './create.js';
import { cmsThemeActiveKey } from './cache.js';

const cfg = parseCmsThemeConfig(JSON.stringify({
  bg: '#101010',
  surface: '#202020',
  text: '#f5f5f5',
  textSecondary: '#aaaaaa',
  primary: '#3366ff',
  primaryHover: '#2244cc',
  cssVars: { '--bg-shell': '#151515' },
}));
const vars = mergeAgentDashboardIdeTokens(variablesFromCmsThemeConfig(cfg), cfg);
assert.equal(vars['--bg-canvas'], '#101010');
assert.equal(vars['--bg-app'], '#101010');
assert.equal(vars['--bg-shell'], '#151515');
assert.equal(vars['--color-primary'], '#3366ff');
assert.equal(vars['--text-main'], '#f5f5f5');

const payload = buildActiveThemeApiPayload({
  id: 'theme-1',
  slug: 'portable-theme',
  name: 'Portable Theme',
  theme_family: 'dark',
  config: JSON.stringify(cfg),
  css_vars_json: JSON.stringify({ '--editor-bg': '#181818' }),
  tokens_json: JSON.stringify({ palette: { accent: '#3366ff' } }),
  components_json: '{}',
});
assert.equal(payload.slug, 'portable-theme');
assert.equal(payload.data['--editor-bg'], '#181818');
assert.equal(payload.monaco_theme, 'portable-theme-monaco');

assert.equal(cmsThemeActiveKey(' ws ', ' user ', ' site '), 'theme:active:ws:user:site');
assert.equal(normalizeThemeSlug('  My New Theme! '), 'my-new-theme');
const paletteConfig = buildConfigFromPalette({ canvas: '#fff', primary: '#123456' }, 'light');
assert.equal(paletteConfig.bg, '#fff');
assert.equal(paletteConfig.primary, '#123456');

const tokens = buildCanonicalThemeTokens(
  { config: JSON.stringify(paletteConfig), monaco_bg: '#111' },
  { '--bg-canvas': '#fff', '--color-primary': '#123456' },
  {},
);
assert.equal(tokens.palette.canvas, '#fff');
assert.equal(tokens.accent.primary, '#123456');

// Dependency firewall for production theme modules.
const themeDir = path.dirname(fileURLToPath(import.meta.url));
for (const file of fs.readdirSync(themeDir).filter((name) => name.endsWith('.js'))) {
  const source = fs.readFileSync(path.join(themeDir, file), 'utf8');
  const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  for (const specifier of imports) {
    assert.doesNotMatch(specifier, /(?:^|\/)cms-theme-[^/]+\.js$/, `${file} imports legacy theme helper ${specifier}`);
    assert.doesNotMatch(specifier, /src\/api\/cms|dashboard|studio-cms-editor/, `${file} imports forbidden CMS implementation ${specifier}`);
  }
  assert.doesNotMatch(source, /env\?\.(?:ASSETS|DASHBOARD|R2|IAM_COLLAB)|env\.(?:ASSETS|DASHBOARD|R2|IAM_COLLAB)/, `${file} names a host binding`);
}

console.log('cms-theme tests: OK');
