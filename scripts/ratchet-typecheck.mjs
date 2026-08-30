#!/usr/bin/env node
/**
 * Ratchet check for `tsc --noEmit` errors.
 *
 * main had 842 pre-existing typecheck errors the day this was added --
 * years of debt, not something any one PR can fix. A hard "must typecheck
 * clean" gate on that baseline would block every PR forever and teach
 * agents to fight errors that were never theirs, which is exactly the
 * fix/revert/fix loop this whole CI overhaul exists to stop.
 *
 * Instead: count errors, store the count, fail CI only if a PR makes it
 * go UP. Every fix lowers the number permanently.
 *
 * Usage:
 *   node scripts/ratchet-typecheck.mjs           # check, exit 1 if worse
 *   node scripts/ratchet-typecheck.mjs --update   # rewrite baseline to current count
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASELINE_FILE = path.join(ROOT, 'scripts', 'ratchet-typecheck-baseline.json');

function countErrors() {
  let output = '';
  try {
    output = execSync('npx tsc --noEmit', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    output = (e.stdout || '') + (e.stderr || '');
  }
  const matches = output.match(/error TS\d+:/g) || [];
  return matches.length;
}

function loadBaseline() {
  if (!existsSync(BASELINE_FILE)) return null;
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
}

function saveBaseline(count) {
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify(
      {
        errorCount: count,
        note: 'tsc --noEmit error count. Must only go down. Regenerate with: node scripts/ratchet-typecheck.mjs --update',
        updatedAt: new Date().toISOString().slice(0, 10),
      },
      null,
      2,
    ) + '\n',
  );
}

console.log('Running tsc --noEmit (this can take a minute)...');
const current = countErrors();
const update = process.argv.includes('--update');

if (update) {
  saveBaseline(current);
  console.log(`Baseline updated: ${current} typecheck errors.`);
  process.exit(0);
}

const baseline = loadBaseline();
if (!baseline) {
  console.error(`No baseline at ${path.relative(ROOT, BASELINE_FILE)}. Run with --update once to record the starting point.`);
  process.exit(1);
}

console.log(`Typecheck errors: ${current} (baseline: ${baseline.errorCount})`);

if (current > baseline.errorCount) {
  console.error(
    `\nRegression: this PR adds ${current - baseline.errorCount} new typecheck error(s).\n` +
    'Fix the type error(s) this change introduced -- run `npm run typecheck` locally to see them.',
  );
  process.exit(1);
}

if (current < baseline.errorCount) {
  console.log(`\nProgress: ${baseline.errorCount - current} fewer typecheck errors than baseline. Run with --update to lock it in.`);
}

process.exit(0);
