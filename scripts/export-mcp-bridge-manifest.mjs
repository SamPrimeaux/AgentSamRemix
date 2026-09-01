#!/usr/bin/env node
/**
 * Export build-ready MCP bridge artifact for inneranimalmedia-mcp-server consolidation.
 * Writes dist/mcp-bridge/manifest.json + schema-twins/*.json snapshots.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const OUT = join(ROOT, 'dist/mcp-bridge');

const bridgeManifest = JSON.parse(
  readFileSync(join(ROOT, 'config/mcp-server/bridge.manifest.json'), 'utf8'),
);

let sdkVersion = null;
try {
  const pkg = require('@inneranimalmedia/agentsam-sdk/package.json');
  sdkVersion = pkg.version || null;
} catch {
  /* optional at export time */
}

const schemaSnapshots = {};
for (const twin of bridgeManifest.schemaTwins || []) {
  const abs = join(ROOT, twin.remixPath);
  if (!existsSync(abs)) continue;
  const mod = await import(pathToFileURL(abs).href);
  schemaSnapshots[twin.mcpServerPath] = {
    exportName: twin.exportName,
    schema: twin.exportName ? mod[twin.exportName] : null,
    remixPath: twin.remixPath,
  };
}

mkdirSync(OUT, { recursive: true });

const exportDoc = {
  ...bridgeManifest,
  generatedAt: new Date().toISOString(),
  remixGitHead: process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || null,
  agentsamSdkVersion: sdkVersion,
  schemaSnapshots,
};

writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(exportDoc, null, 2)}\n`);
console.log(`Wrote ${join(OUT, 'manifest.json')}`);
