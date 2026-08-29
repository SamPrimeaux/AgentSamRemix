#!/usr/bin/env node
/**
 * node-pty ships spawn-helper without +x in some npm install paths (e.g. after cleanup).
 * Without execute bit, every pty.spawn() fails with "posix_spawnp failed."
 */
import { chmodSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "node-pty", "prebuilds");
const targets = [
  path.join(root, "darwin-arm64", "spawn-helper"),
  path.join(root, "darwin-x64", "spawn-helper"),
];

for (const p of targets) {
  if (!existsSync(p)) continue;
  try {
    chmodSync(p, 0o755);
  } catch (_) {}
}
