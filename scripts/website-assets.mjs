#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  watch as fsWatch,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(
  ROOT,
  process.env.WEBSITE_ASSETS_CONFIG || 'config/website-assets.json',
);
const WRANGLER = resolve(ROOT, 'node_modules/.bin/wrangler');
const CURRENT_KEY = 'current.json';
const MANIFEST_PREFIX = 'manifests/';
const OBJECT_PREFIX = 'objects/sha256/';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readConfig() {
  const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  if (parsed?.version !== 1 || !Array.isArray(parsed?.assets) || !parsed.assets.length) {
    throw new Error(`Invalid WEBSITE_ASSETS config: ${CONFIG_PATH}`);
  }
  const seen = new Set();
  for (const asset of parsed.assets) {
    if (!asset?.logical_key || !asset?.source || !['direct', 'build'].includes(asset?.mode)) {
      throw new Error(`Invalid WEBSITE_ASSETS asset row: ${JSON.stringify(asset)}`);
    }
    if (seen.has(asset.logical_key)) throw new Error(`Duplicate logical key: ${asset.logical_key}`);
    seen.add(asset.logical_key);
  }
  return parsed;
}

const CONFIG = readConfig();
const BUCKET = process.env.WEBSITE_ASSETS_BUCKET || CONFIG.bucket;

function gitMeta() {
  const run = (args) => {
    const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    return result.status === 0 ? String(result.stdout || '').trim() : '';
  };
  return {
    commit: run(['rev-parse', 'HEAD']) || null,
    dirty: Boolean(run(['status', '--porcelain'])),
  };
}

function wrangler(args, options = {}) {
  if (!existsSync(WRANGLER)) {
    throw new Error(`Wrangler binary missing: ${WRANGLER}. Run npm install first.`);
  }
  const result = spawnSync(WRANGLER, args, {
    cwd: ROOT,
    encoding: options.binary ? null : 'utf8',
    input: options.input,
    maxBuffer: 32 * 1024 * 1024,
  });
  return result;
}

function remoteGet(key, { allowMissing = false } = {}) {
  const result = wrangler(
    ['r2', 'object', 'get', `${BUCKET}/${key}`, '--remote', '--pipe'],
    { binary: true },
  );
  if (result.status === 0) return Buffer.from(result.stdout || Buffer.alloc(0));
  const stderr = Buffer.from(result.stderr || Buffer.alloc(0)).toString('utf8');
  if (allowMissing && /specified key does not exist/i.test(stderr)) return null;
  throw new Error(`R2 get failed for ${key}: ${stderr.trim() || `exit ${result.status}`}`);
}

function remotePutFile(key, file, contentType, cacheControl) {
  const args = [
    'r2', 'object', 'put', `${BUCKET}/${key}`,
    '--remote', '--force', `--file=${file}`,
    `--content-type=${contentType}`,
    `--cache-control=${cacheControl}`,
  ];
  const result = wrangler(args);
  if (result.status !== 0) {
    throw new Error(`R2 put failed for ${key}: ${String(result.stderr || '').trim()}`);
  }
}

function remotePutJson(key, value, cacheControl = 'no-store') {
  const dir = mkdtempSync(join(tmpdir(), 'iam-website-assets-'));
  const file = join(dir, 'object.json');
  try {
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    remotePutFile(key, file, 'application/json; charset=utf-8', cacheControl);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function remoteDelete(key) {
  const result = wrangler(['r2', 'object', 'delete', `${BUCKET}/${key}`, '--remote', '--force']);
  if (result.status !== 0) {
    throw new Error(`R2 delete failed for ${key}: ${String(result.stderr || '').trim()}`);
  }
}

function parseJsonBuffer(buffer, key) {
  if (!buffer) return null;
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid JSON in R2 ${key}: ${error?.message || error}`);
  }
}

function readCurrent({ allowMissing = true } = {}) {
  return parseJsonBuffer(remoteGet(CURRENT_KEY, { allowMissing }), CURRENT_KEY);
}

function sourceRecord(asset) {
  const file = resolve(ROOT, asset.source);
  if (!existsSync(file)) {
    throw new Error(`WEBSITE_ASSETS source missing: ${asset.source}`);
  }
  const body = readFileSync(file);
  const hash = sha256(body);
  const extension = extname(asset.logical_key) || '.bin';
  return {
    record: {
      key: `${OBJECT_PREFIX}${hash.slice(0, 2)}/${hash}${extension}`,
      sha256: hash,
      bytes: body.byteLength,
      content_type: asset.content_type || 'application/octet-stream',
      cache_control: asset.cache_control || 'public, max-age=0, must-revalidate',
    },
    body,
    file,
  };
}

function releaseId(objects) {
  const identity = Object.entries(objects)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([logicalKey, record]) => `${logicalKey}\0${record.sha256}`)
    .join('\n');
  return `sha256-${sha256(identity).slice(0, 24)}`;
}

function sameReleaseObjects(a, b) {
  const aKeys = Object.keys(a || {}).sort();
  const bKeys = Object.keys(b || {}).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key, index) => {
    if (key !== bKeys[index]) return false;
    return a[key]?.sha256 === b[key]?.sha256 && a[key]?.key === b[key]?.key;
  });
}

function verifyObject(logicalKey, record) {
  const body = remoteGet(record.key, { allowMissing: true });
  if (!body) throw new Error(`Missing immutable object for ${logicalKey}: ${record.key}`);
  const actual = sha256(body);
  if (actual !== record.sha256) {
    throw new Error(`Hash mismatch for ${logicalKey}: expected ${record.sha256}, got ${actual}`);
  }
}

function verifyRelease(pointer, { quiet = false } = {}) {
  if (!pointer?.release || !pointer?.manifest || !pointer?.objects) {
    throw new Error('WEBSITE_ASSETS current.json is missing release/manifest/objects');
  }
  for (const [logicalKey, record] of Object.entries(pointer.objects)) {
    verifyObject(logicalKey, record);
  }
  if (!quiet) console.log(`✓ verified ${Object.keys(pointer.objects).length} immutable objects (${pointer.release})`);
}

function sync({ includeBuild = false, dryRun = false } = {}) {
  const current = readCurrent({ allowMissing: true });
  const objects = {};
  const locals = new Map();

  for (const asset of CONFIG.assets) {
    if (asset.mode === 'build' && !includeBuild) {
      const existing = current?.objects?.[asset.logical_key];
      if (!existing) {
        throw new Error(
          `No promoted build object exists for ${asset.logical_key}. Run 'bin/agentsam deploy fast' once to bootstrap WEBSITE_ASSETS.`,
        );
      }
      objects[asset.logical_key] = existing;
      continue;
    }
    const local = sourceRecord(asset);
    objects[asset.logical_key] = local.record;
    locals.set(asset.logical_key, local);
  }

  const changed = CONFIG.assets.filter((asset) => {
    const previous = current?.objects?.[asset.logical_key];
    const next = objects[asset.logical_key];
    return !previous || previous.sha256 !== next.sha256 || previous.key !== next.key;
  });

  if (current && sameReleaseObjects(current.objects, objects)) {
    console.log(`✓ WEBSITE_ASSETS unchanged (${current.release})`);
    for (const asset of CONFIG.assets) {
      const mode = asset.mode === 'build' && !includeBuild ? 'preserved' : 'unchanged';
      console.log(`  = ${asset.logical_key.padEnd(22)} ${mode}`);
    }
    return current;
  }

  const release = releaseId(objects);
  console.log(`→ WEBSITE_ASSETS ${dryRun ? 'plan' : 'sync'} (${BUCKET})`);
  console.log(`  release ${release}`);
  for (const asset of CONFIG.assets) {
    const isChanged = changed.some((row) => row.logical_key === asset.logical_key);
    const prefix = isChanged ? '↑' : '=';
    const mode = asset.mode === 'build' && !includeBuild ? 'preserve build' : isChanged ? 'changed' : 'unchanged';
    console.log(`  ${prefix} ${asset.logical_key.padEnd(22)} ${mode}`);
  }
  if (dryRun) return { release, objects };

  let uploaded = 0;
  let reused = 0;
  let uploadedBytes = 0;

  for (const asset of CONFIG.assets) {
    const logicalKey = asset.logical_key;
    const record = objects[logicalKey];
    const previous = current?.objects?.[logicalKey];
    if (previous?.sha256 === record.sha256 && previous?.key === record.key) {
      reused += 1;
      continue;
    }

    const remote = remoteGet(record.key, { allowMissing: true });
    if (remote) {
      const actual = sha256(remote);
      if (actual !== record.sha256) {
        throw new Error(`Existing immutable object has wrong hash: ${record.key}`);
      }
      reused += 1;
      continue;
    }

    const local = locals.get(logicalKey);
    if (!local) {
      throw new Error(`Cannot recreate preserved build object ${logicalKey}; immutable payload is missing remotely.`);
    }
    remotePutFile(record.key, local.file, record.content_type, 'public, max-age=31536000, immutable');
    uploaded += 1;
    uploadedBytes += record.bytes;
  }

  // Promotion is allowed only after every referenced payload exists and hashes correctly.
  for (const [logicalKey, record] of Object.entries(objects)) verifyObject(logicalKey, record);

  const manifestKey = `${MANIFEST_PREFIX}${release}.json`;
  const existingManifest = parseJsonBuffer(remoteGet(manifestKey, { allowMissing: true }), manifestKey);
  if (existingManifest) {
    if (!sameReleaseObjects(existingManifest.objects, objects)) {
      throw new Error(`Immutable manifest collision: ${manifestKey}`);
    }
  } else {
    remotePutJson(manifestKey, {
      schema: 'iam.website-assets.release.v1',
      version: 1,
      release,
      created_at: new Date().toISOString(),
      objects,
    }, 'public, max-age=31536000, immutable');
  }

  const git = gitMeta();
  const pointer = {
    schema: 'iam.website-assets.current.v1',
    version: 1,
    release,
    manifest: manifestKey,
    promoted_at: new Date().toISOString(),
    commit: git.commit,
    dirty: git.dirty,
    previous_release: current?.release || null,
    objects,
  };
  remotePutJson(CURRENT_KEY, pointer, 'no-store');

  const promoted = readCurrent({ allowMissing: false });
  if (promoted.release !== release || !sameReleaseObjects(promoted.objects, objects)) {
    throw new Error(`Promotion verification failed: expected ${release}, got ${promoted?.release || 'unknown'}`);
  }

  console.log(`✓ promoted ${release}`);
  console.log(`  uploaded ${uploaded} immutable object(s), ${uploadedBytes} byte(s)`);
  console.log(`  reused   ${reused} immutable object(s)`);
  return promoted;
}

function status() {
  const current = readCurrent({ allowMissing: true });
  if (!current) {
    console.log('WEBSITE_ASSETS: uninitialized (current.json missing)');
    return;
  }
  console.log(`WEBSITE_ASSETS ${BUCKET}`);
  console.log(`release:   ${current.release}`);
  console.log(`commit:    ${current.commit || 'unknown'}${current.dirty ? ' (dirty)' : ''}`);
  console.log(`promoted:  ${current.promoted_at || 'unknown'}`);
  console.log(`previous:  ${current.previous_release || '-'}`);
  for (const asset of CONFIG.assets) {
    const record = current.objects?.[asset.logical_key];
    let local = '-';
    if (asset.mode === 'direct' && existsSync(resolve(ROOT, asset.source))) {
      local = sha256(readFileSync(resolve(ROOT, asset.source))) === record?.sha256 ? 'local=match' : 'local=changed';
    }
    console.log(`  ${asset.logical_key.padEnd(22)} ${String(record?.sha256 || 'missing').slice(0, 12)} ${local}`);
  }
}

function verify({ strict = false } = {}) {
  const current = readCurrent({ allowMissing: false });
  verifyRelease(current);
  const manifest = parseJsonBuffer(remoteGet(current.manifest, { allowMissing: false }), current.manifest);
  if (!manifest || manifest.release !== current.release || !sameReleaseObjects(manifest.objects, current.objects)) {
    throw new Error(`Manifest/current mismatch for ${current.release}`);
  }
  console.log(`✓ manifest ${current.manifest}`);

  if (strict) {
    const found = [];
    for (const key of CONFIG.legacy_mutable_keys || []) {
      if (remoteGet(key, { allowMissing: true })) found.push(key);
    }
    if (found.length) {
      throw new Error(`Legacy mutable WEBSITE_ASSETS keys still exist: ${found.join(', ')}`);
    }
    console.log('✓ no legacy mutable shell keys');
  }
}

function retireLegacy() {
  const current = readCurrent({ allowMissing: false });
  verifyRelease(current);
  let removed = 0;
  for (const key of CONFIG.legacy_mutable_keys || []) {
    if (!remoteGet(key, { allowMissing: true })) continue;
    console.log(`  × ${key}`);
    remoteDelete(key);
    removed += 1;
  }
  console.log(`✓ retired ${removed} legacy mutable key(s)`);
}

function rollback(release) {
  if (!release) throw new Error('usage: bin/agentsam website rollback <release>');
  const manifestKey = `${MANIFEST_PREFIX}${release}.json`;
  const manifest = parseJsonBuffer(remoteGet(manifestKey, { allowMissing: false }), manifestKey);
  if (!manifest?.objects || manifest.release !== release) {
    throw new Error(`Invalid release manifest: ${manifestKey}`);
  }
  for (const [logicalKey, record] of Object.entries(manifest.objects)) verifyObject(logicalKey, record);
  const current = readCurrent({ allowMissing: true });
  const git = gitMeta();
  const pointer = {
    schema: 'iam.website-assets.current.v1',
    version: 1,
    release,
    manifest: manifestKey,
    promoted_at: new Date().toISOString(),
    commit: git.commit,
    dirty: git.dirty,
    previous_release: current?.release || null,
    rollback: true,
    objects: manifest.objects,
  };
  remotePutJson(CURRENT_KEY, pointer, 'no-store');
  console.log(`✓ rolled WEBSITE_ASSETS back to ${release}`);
}

function watchDirect() {
  sync({ includeBuild: false });
  const direct = CONFIG.assets.filter((asset) => asset.mode === 'direct');
  const byDir = new Map();
  for (const asset of direct) {
    const full = resolve(ROOT, asset.source);
    const dir = dirname(full);
    const names = byDir.get(dir) || new Set();
    names.add(basename(full));
    byDir.set(dir, names);
  }

  console.log(`→ watching ${direct.length} direct WEBSITE_ASSETS source(s)`);
  let timer = null;
  let syncing = false;
  let pending = false;
  const runSync = () => {
    if (syncing) {
      pending = true;
      return;
    }
    syncing = true;
    try {
      sync({ includeBuild: false });
    } catch (error) {
      console.error(`✗ ${error?.message || error}`);
    } finally {
      syncing = false;
      if (pending) {
        pending = false;
        runSync();
      }
    }
  };

  const watchers = [];
  for (const [dir, names] of byDir.entries()) {
    watchers.push(fsWatch(dir, (event, filename) => {
      if (!filename || !names.has(String(filename))) return;
      clearTimeout(timer);
      timer = setTimeout(runSync, 400);
    }));
  }
  const close = () => {
    for (const watcher of watchers) watcher.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}

function usage() {
  console.log(`usage: bin/agentsam website <command> [options]\n\nCommands:\n  sync                 hash + publish changed direct HTML only; no Vite, no Worker deploy\n  sync --all           include build-coupled index.html (used by frontend deploys)\n  sync --dry-run       show direct HTML changes without writing R2\n  watch                watch direct HTML and sync only when bytes change\n  status               show promoted release and local direct-file drift\n  verify [--strict]    verify manifest + payload hashes; strict rejects retired mutable keys\n  rollback <release>   atomically promote a previous immutable release\n  retire-legacy        delete the six old mutable keys after the new Worker is live`);
}

function main(argv) {
  const [command = 'help', ...rest] = argv;
  if (command === 'sync') {
    sync({ includeBuild: rest.includes('--all'), dryRun: rest.includes('--dry-run') });
    return;
  }
  if (command === 'watch') return watchDirect();
  if (command === 'status') return status();
  if (command === 'verify') return verify({ strict: rest.includes('--strict') });
  if (command === 'rollback') return rollback(rest[0]);
  if (command === 'retire-legacy') return retireLegacy();
  if (command === 'help' || command === '--help' || command === '-h') return usage();
  throw new Error(`Unknown website-assets command: ${command}`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(`✗ ${error?.message || error}`);
  process.exit(1);
}
