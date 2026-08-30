#!/usr/bin/env node
/**
 * Ratchet check for the backend/** -> root src/** legacy edge.
 *
 * Can't be a hard "forbidden" rule yet -- ~120 existing files depend on it.
 * Instead: count it, store the count, fail CI only if a PR makes it go UP.
 * Every extraction that removes a reference lowers the number permanently.
 *
 * Usage:
 *   node scripts/ratchet-backend-src.mjs           # check, exit 1 if worse
 *   node scripts/ratchet-backend-src.mjs --update   # rewrite baseline to current count
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BACKEND_DIR = path.join(ROOT, 'backend');
const BASELINE_FILE = path.join(ROOT, 'scripts', 'ratchet-backend-src-baseline.json');
const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const IMPORT_RE = /\b(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (CODE_EXT.has(path.extname(entry))) out.push(full);
  }
  return out;
}

function resolvesIntoRootSrc(fromFile, specifier) {
  if (!specifier.startsWith('.')) return false;
  const resolved = path.normalize(path.join(path.dirname(fromFile), specifier));
  const rel = path.relative(ROOT, resolved);
  return rel === 'src' || rel.startsWith(`src${path.sep}`);
}

function countViolations() {
  const files = walk(BACKEND_DIR);
  let refCount = 0;
  const fileSet = new Set();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(text))) {
      if (resolvesIntoRootSrc(file, m[1])) {
        refCount += 1;
        fileSet.add(file);
      }
    }
  }
  return { refCount, fileCount: fileSet.size };
}

function loadBaseline() {
  if (!existsSync(BASELINE_FILE)) return null;
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
}

function saveBaseline(counts) {
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify(
      {
        ...counts,
        note: 'backend/** -> root src/** legacy import count. Must only go down. Regenerate with: node scripts/ratchet-backend-src.mjs --update',
        updatedAt: new Date().toISOString().slice(0, 10),
      },
      null,
      2,
    ) + '\n',
  );
}

const current = countViolations();
const update = process.argv.includes('--update');

if (update) {
  saveBaseline(current);
  console.log(`Baseline updated: ${current.refCount} references across ${current.fileCount} files.`);
  process.exit(0);
}

const baseline = loadBaseline();
if (!baseline) {
  console.error(`No baseline at ${path.relative(ROOT, BASELINE_FILE)}. Run with --update once to record the starting point.`);
  process.exit(1);
}

console.log(`backend/** -> src/** references: ${current.refCount} (baseline: ${baseline.refCount}), files: ${current.fileCount} (baseline: ${baseline.fileCount})`);

if (current.refCount > baseline.refCount || current.fileCount > baseline.fileCount) {
  console.error(
    '\nRegression: this PR adds new backend/** imports reaching into root src/**.\n' +
    'That edge is legacy debt being paid down, not a pattern to extend.\n' +
    'Fix: import from backend/** or packages/** instead.',
  );
  process.exit(1);
}

if (current.refCount < baseline.refCount) {
  console.log(`\nProgress: ${baseline.refCount - current.refCount} fewer legacy references than baseline. Run with --update to lock it in.`);
}

process.exit(0);
