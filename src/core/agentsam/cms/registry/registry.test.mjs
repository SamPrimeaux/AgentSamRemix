import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCmsFieldValues,
  buildCmsSchemaManifest,
  flattenCmsFields,
  getCmsBlock,
  getCmsFieldType,
  getCmsSchema,
  getCmsSection,
  inferCmsFieldKind,
  listCmsBlocks,
  listCmsFieldTypes,
  listCmsSections,
  migrateCmsContent,
  registerCmsMigration,
  validateCmsContent,
} from './index.js';

test('built-in field kinds are registered', () => {
  assert.ok(listCmsFieldTypes().length >= 9);
  assert.equal(getCmsFieldType('text')?.kind, 'text');
  assert.equal(getCmsFieldType('richtext')?.kind, 'richtext');
  assert.equal(getCmsFieldType('asset')?.kind, 'asset');
});

test('field kind inference preserves primitive intent', () => {
  assert.equal(inferCmsFieldKind('hello'), 'text');
  assert.equal(inferCmsFieldKind(42), 'number');
  assert.equal(inferCmsFieldKind(false), 'boolean');
  assert.equal(inferCmsFieldKind(['a']), 'json');
});

test('flattenCmsFields respects nested paths and omit keys', () => {
  const rows = flattenCmsFields(
    { title: 'Hero', enabled: true, layout: { columns: 3 }, html: '<b>skip</b>' },
    { omitKeys: new Set(['html']) },
  );
  assert.deepEqual(rows.map((row) => row.path), ['title', 'enabled', 'layout.columns']);
});

test('applyCmsFieldValues preserves existing stored types', () => {
  const value = applyCmsFieldValues(
    { title: 'Old', enabled: false, count: 1, items: ['one'] },
    { title: 'New', enabled: 'true', count: '2', items: '["two"]' },
  );
  assert.deepEqual(value, { title: 'New', enabled: true, count: 2, items: ['two'] });
});

test('builtin section/block catalog is registered once for all consumers', () => {
  assert.equal(getCmsSection('hero', 1)?.key, 'hero@1');
  assert.equal(getCmsSection('rich-text', 1)?.fields.body.type, 'richtext');
  assert.equal(getCmsSection('image', 1)?.fields.asset.required, true);
  assert.equal(getCmsSection('cta', 1)?.allowedBlocks.includes('button'), true);
  assert.equal(getCmsSection('features', 1)?.allowedBlocks.includes('feature-item'), true);
  assert.equal(getCmsBlock('button', 1)?.fields.label.required, true);
  assert.equal(getCmsBlock('badge', 1)?.type, 'badge');
  assert.ok(listCmsSections().length >= 6);
  assert.ok(listCmsBlocks().length >= 3);
});

test('schema manifest exposes one shared content protocol', () => {
  const manifest = buildCmsSchemaManifest();
  assert.equal(manifest.protocol_version, 1);
  assert.ok(manifest.sections.some((row) => row.key === 'hero@1'));
  assert.ok(manifest.blocks.some((row) => row.key === 'button@1'));
  assert.equal(getCmsSchema('section', 'hero', 1)?.type, 'hero');
  assert.equal(getCmsSchema('block', 'button', 1)?.type, 'button');
});

test('validateCmsContent enforces required fields and allowed blocks', () => {
  const ok = validateCmsContent('section', 'hero', {
    heading: 'Welcome',
    body: '<p>Hi</p>',
    primaryCta: { label: 'Go', href: '/go' },
  });
  assert.equal(ok.ok, true);

  const missing = validateCmsContent('section', 'hero', { body: 'x' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'validation_failed');
  assert.ok(missing.issues.some((issue) => issue.code === 'required' && issue.path === 'heading'));

  const badBlock = validateCmsContent(
    'section',
    'hero',
    { heading: 'Ok' },
    { blockTypes: ['feature-item'] },
  );
  assert.equal(badBlock.ok, false);
  assert.ok(badBlock.issues.some((issue) => issue.code === 'block_not_allowed'));

  const allowed = validateCmsContent(
    'section',
    'hero',
    { heading: 'Ok' },
    { blockTypes: ['button', 'badge'] },
  );
  assert.equal(allowed.ok, true);
});

test('migrateCmsContent fails loud without a registered path', () => {
  const missing = migrateCmsContent('hero', { heading: 'A' }, { fromVersion: 1, toVersion: 2 });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /migration_not_found/);

  registerCmsMigration({
    type: 'hero',
    fromVersion: 1,
    toVersion: 2,
    migrate: (data) => ({ ...data, heading: String(data.heading || '').toUpperCase() }),
  });
  const moved = migrateCmsContent('hero', { heading: 'hello' }, { fromVersion: 1, toVersion: 2 });
  assert.equal(moved.ok, true);
  assert.equal(moved.data.heading, 'HELLO');
});
