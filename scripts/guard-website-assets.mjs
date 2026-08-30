#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const configPath = resolve(root, 'config/website-assets.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const fail = (message) => {
  console.error(`guard:website-assets FAIL: ${message}`);
  process.exit(1);
};

if (config.version !== 1) fail('config version must be 1');
if (!Array.isArray(config.assets) || !config.assets.length) fail('assets list is required');

const expected = new Set([
  'index.html',
  'site/home.html',
  'auth/login.html',
  'auth/signup.html',
  'auth/reset.html',
  'cms/studio.html',
]);
const keys = new Set();
let buildCount = 0;
for (const asset of config.assets) {
  if (keys.has(asset.logical_key)) fail(`duplicate logical key ${asset.logical_key}`);
  keys.add(asset.logical_key);
  if (!expected.has(asset.logical_key)) fail(`unexpected logical key ${asset.logical_key}`);
  if (!existsSync(resolve(root, asset.source)) && asset.mode !== 'build') fail(`missing direct source ${asset.source}`);
  if (asset.mode === 'direct' && asset.source.startsWith('app/dist/')) fail(`direct asset points at build output: ${asset.source}`);
  if (asset.mode === 'build') {
    buildCount += 1;
    if (asset.logical_key !== 'index.html' || asset.source !== 'app/dist/index.html') {
      fail('index.html must be the only build-coupled WEBSITE_ASSETS shell');
    }
  }
}
for (const key of expected) if (!keys.has(key)) fail(`missing logical key ${key}`);
if (buildCount !== 1) fail(`expected exactly one build-coupled shell, found ${buildCount}`);

const forbiddenSources = [
  'app/public/agentsam-home.html',
  'app/dist/auth/login.html',
  'app/dist/auth/signup.html',
  'app/dist/auth/reset.html',
  'app/dist/cms/studio-cms-shell.html',
];
for (const path of forbiddenSources) {
  if (config.assets.some((asset) => asset.source === path)) fail(`retired source returned: ${path}`);
}

console.log('guard:website-assets OK');
