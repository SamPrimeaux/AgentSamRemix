/**
 * Sprint 3 CMS vertical proof — hero only.
 *
 * definition → registry → schema manifest → validate → edit payload
 * → preview HTML → published HTML (same renderer)
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCmsSchemaManifest,
  getCmsSection,
  validateCmsContent,
} from './index.js';
import {
  renderCmsPreviewFallbackHtml,
  renderCmsPublishedSectionsHtml,
  renderCmsRegisteredSectionHtml,
} from '../preview/render.js';

test('hero vertical: one definition drives registry → schema → validate → preview → public render', () => {
  const def = getCmsSection('hero', 1);
  assert.ok(def, 'hero must be registered');
  assert.equal(def.type, 'hero');
  assert.equal(def.fields.heading?.required, true, 'heading is required in schema');
  assert.equal(def.defaults.heading, 'Headline');

  const manifest = buildCmsSchemaManifest();
  const listed = manifest.sections.find((row) => row.type === 'hero');
  assert.ok(listed, 'bootstrap schema manifest must expose hero');
  assert.deepEqual(Object.keys(listed.fields).sort(), Object.keys(def.fields).sort());

  const edited = {
    eyebrow: 'Sprint 3',
    heading: 'Canonical hero path',
    body: 'One definition drives editor, preview, and public render.',
    image: { url: 'https://cdn.example/hero.jpg' },
    primaryCta: { label: 'Prove it', href: '/pricing' },
  };
  const checked = validateCmsContent('section', 'hero', edited);
  assert.equal(checked.ok, true, checked.ok ? '' : JSON.stringify(checked.issues));
  assert.equal(checked.data.heading, 'Canonical hero path');

  const missing = validateCmsContent('section', 'hero', { eyebrow: 'x' });
  assert.equal(missing.ok, false);
  assert.ok((missing.issues || []).some((i) => i.path === 'heading'));

  const sectionHtml = renderCmsRegisteredSectionHtml('hero', checked.data, {
    id: 'sec_hero_proof',
    name: 'Hero',
  });
  assert.match(sectionHtml, /data-section-type="hero"/);
  assert.match(sectionHtml, /Canonical hero path/);
  assert.match(sectionHtml, /Prove it/);
  assert.match(sectionHtml, /cdn\.example\/hero\.jpg/);

  const previewDoc = renderCmsPreviewFallbackHtml({
    sections: [{ id: 'sec_hero_proof', type: 'hero', name: 'Hero', data: checked.data, visible: true }],
    blocks_by_section: {},
  });
  assert.match(previewDoc, /Canonical hero path/);
  assert.match(previewDoc, /cms-hero/);

  const publicDoc = renderCmsPublishedSectionsHtml([
    {
      id: 'sec_hero_proof',
      section_type: 'hero',
      section_name: 'Hero',
      section_data: checked.data,
      is_visible: 1,
    },
  ]);
  assert.equal(publicDoc, previewDoc, 'public hydrate must use the same renderer as preview');
});
