import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cmsTemplateNeedsHtmlInstantiate,
  resolveCmsTemplateSectionData,
  resolveCmsTemplateSectionType,
} from './apply.js';
import { ensureCmsBuiltinCatalog } from '../registry/catalog.js';

ensureCmsBuiltinCatalog();

test('resolveCmsTemplateSectionType maps catalog rows to portable section types', () => {
  assert.equal(resolveCmsTemplateSectionType({ template_type: 'services_grid', template_name: 'Services Grid' }), 'services-grid');
  assert.equal(resolveCmsTemplateSectionType({ template_type: 'hero', template_name: 'Hero Section' }), 'hero');
  assert.equal(resolveCmsTemplateSectionType({ template_type: 'section', category: 'features', template_name: 'Features - 3 Column Grid' }), 'features');
});

test('resolveCmsTemplateSectionData fills stub templates from registry defaults', () => {
  const data = resolveCmsTemplateSectionData({
    id: 'tmpl_75e1484c55a2',
    template_name: 'Services Grid',
    template_type: 'services_grid',
    template_data: '{"fields": [], "defaults": {}}',
  }, 'services-grid');
  assert.equal(data.heading, 'Services');
  assert.equal(data._template_id, 'tmpl_75e1484c55a2');
});

test('cmsTemplateNeedsHtmlInstantiate only for page-shaped HTML templates', () => {
  assert.equal(cmsTemplateNeedsHtmlInstantiate({ template_type: 'section', source_html_r2_key: null }), false);
  assert.equal(cmsTemplateNeedsHtmlInstantiate({ template_type: 'marketing_page', source_html_r2_key: 'cms/x.html' }), true);
});
