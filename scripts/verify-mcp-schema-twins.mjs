#!/usr/bin/env node
/**
 * Verify MCP schema twin modules exist and export expected symbols.
 * Run in CI before deploy — keeps AgentSamRemix aligned with inneranimalmedia-mcp-server.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(ROOT, 'config/mcp-server/bridge.manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const twins = manifest.schemaTwins || [];

const issues = [];

for (const twin of twins) {
  const abs = join(ROOT, twin.remixPath);
  if (!existsSync(abs)) {
    issues.push(`missing remix twin: ${twin.remixPath}`);
    continue;
  }
  try {
    const mod = await import(pathToFileURL(abs).href);
    if (twin.exportName && mod[twin.exportName] == null) {
      issues.push(`${twin.remixPath}: missing export ${twin.exportName}`);
    }
  } catch (e) {
    issues.push(`${twin.remixPath}: import failed — ${e?.message || e}`);
  }
}

if (issues.length) {
  console.error('MCP schema twin verification failed:\n');
  for (const issue of issues) console.error(`  • ${issue}`);
  process.exit(1);
}

console.log(`MCP schema twins OK (${twins.length} modules)`);
