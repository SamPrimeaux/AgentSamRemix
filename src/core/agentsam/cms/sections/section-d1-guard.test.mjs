import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CMS_SECTION_D1_MAX_BYTES,
  CmsSectionDataGuardError,
  assertSectionDataD1Writable,
} from './fields.js';

test('assertSectionDataD1Writable allows typed fields and inject pointers', () => {
  const normalized = assertSectionDataD1Writable({
    headline: 'Hello',
    r2_key: 'cms/sections/home/hero/abc.html',
    html_source: 'injected',
  });
  assert.equal(normalized.headline, 'Hello');
  assert.equal(normalized.r2_key, 'cms/sections/home/hero/abc.html');
});

test('assertSectionDataD1Writable rejects markup blob keys', () => {
  assert.throws(
    () => assertSectionDataD1Writable({ headline: 'Hi', html: '<p>x</p>' }),
    (err) => {
      assert.ok(err instanceof CmsSectionDataGuardError);
      assert.equal(err.code, 'section_data_blob_forbidden');
      assert.equal(err.details.key, 'html');
      return true;
    },
  );
});

test('assertSectionDataD1Writable rejects body_html keys', () => {
  assert.throws(
    () => assertSectionDataD1Writable({ body_html: '<section></section>' }),
    (err) => err instanceof CmsSectionDataGuardError && err.code === 'section_data_blob_forbidden',
  );
});

test('assertSectionDataD1Writable rejects payloads over D1 ceiling', () => {
  const big = 'x'.repeat(CMS_SECTION_D1_MAX_BYTES);
  assert.throws(
    () => assertSectionDataD1Writable({ body: big }),
    (err) => {
      assert.ok(err instanceof CmsSectionDataGuardError);
      assert.equal(err.code, 'section_data_exceeds_d1_ceiling');
      assert.ok(Number(err.details.bytes) > CMS_SECTION_D1_MAX_BYTES);
      return true;
    },
  );
});
