#!/usr/bin/env node
/**
 * guard-dependency-law.mjs
 *
 * Enforces a strict import direction between layers. A file may only import
 * from its own layer or a lower-numbered one. Fails the build on any
 * upward import — no warn-only mode. Run this in CI on every PR, not just
 * locally, or it will not do its job.
 *
 * Layers are directories, cheapest possible model to start with. Add real
 * per-file classification later if directories stop being granular enough —
 * do not add that complexity before you need it.
 *
 * Usage: node scripts/guard-dependency-law.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

// Lower index = lower layer. A file in layer N may import layer <= N only.
// Edit this list as the repo grows — but every edit should be a deliberate
// architectural decision, not a guard-silencing reflex.
const LAYERS = [
  'src/lib',          // 0 — pure utilities, zero app-specific knowledge
  'src/components/editor', // 1 — Monaco wrapper, must stay decoupled
  'src/components',   // 2 — everything else UI
  'worker/adapters',  // 3 — SDK/MCP/GitHub adapters
  'worker/routes',    // 4 — route handlers, may use adapters
  'worker',           // 5 — top-level worker composition
];

function layerOf(filePath) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  for (let i = LAYERS.length - 1; i >= 0; i--) {
    if (rel.startsWith(LAYERS[i] + '/')) return i;
  }
  return -1; // unclassified — not enforced, but should shrink toward zero
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.wrangler') continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function importsOf(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const specs = [];
  const importRe = /from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(text))) specs.push(m[1]);
  return specs;
}

function resolveRelative(fromFile, spec) {
  return path.normalize(path.join(path.dirname(fromFile), spec));
}

function main() {
  const files = [
    ...(existsDir('src') ? walk(path.join(ROOT, 'src')) : []),
    ...(existsDir('worker') ? walk(path.join(ROOT, 'worker')) : []),
  ];

  let violations = 0;
  for (const file of files) {
    const fileLayer = layerOf(file);
    if (fileLayer === -1) continue; // unclassified files aren't enforced

    for (const spec of importsOf(file)) {
      const resolved = resolveRelative(file, spec);
      const candidates = [resolved, resolved + '.ts', resolved + '.tsx', resolved + '.js'];
      const target = candidates.find((c) => existsFile(c));
      if (!target) continue;

      const targetLayer = layerOf(target);
      if (targetLayer === -1) continue;

      if (targetLayer > fileLayer) {
        violations++;
        console.error(
          `[dependency-law] ${path.relative(ROOT, file)} (layer ${fileLayer}) ` +
          `-> ${path.relative(ROOT, target)} (layer ${targetLayer}) — upward import`,
        );
      }
    }
  }

  if (violations > 0) {
    console.error(`\nguard:dependency-law FAILED — ${violations} upward import(s).`);
    process.exit(1);
  }
  console.log('guard:dependency-law OK');
}

function existsDir(p) {
  try { return statSync(path.join(ROOT, p)).isDirectory(); } catch { return false; }
}
function existsFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

main();
