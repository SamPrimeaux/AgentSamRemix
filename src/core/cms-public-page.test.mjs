import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CMS_PUBLIC_MANIFEST_PILOT_ROUTES,
  loadPublishedCmsSectionsByRoute,
} from './cms-public-page.js';

test('pilot route fallback skips D1 section_data blobs', async () => {
  const env = {
    DB: {
      prepare(sql) {
        if (String(sql).includes('FROM cms_pages')) {
          return {
            bind(route) {
              return {
                first: async () => ({
                  id: 'page_home',
                  route_path: '/',
                  slug: 'home',
                  status: 'published',
                  published_manifest_r2_key: null,
                }),
              };
            },
          };
        }
        return {
          bind(pageId) {
            return {
              all: async () => ({
                results: [
                  {
                    id: 'sec_1',
                    section_type: 'hero',
                    section_name: 'hero',
                    section_data: JSON.stringify({ headline: 'from-d1', html: '<p>legacy</p>' }),
                    sort_order: 10,
                    is_visible: 1,
                    published_r2_key: null,
                  },
                ],
              }),
            };
          },
        };
      },
    },
  };

  const bundle = await loadPublishedCmsSectionsByRoute(env, '/');
  assert.equal(bundle.source, 'pilot_d1_fallback');
  assert.deepEqual(bundle.sections[0].section_data, {});
  assert.equal(CMS_PUBLIC_MANIFEST_PILOT_ROUTES.includes('/'), true);
});

test('non-pilot route fallback still reads D1 section_data when R2 missing', async () => {
  const env = {
    DB: {
      prepare(sql) {
        if (String(sql).includes('FROM cms_pages')) {
          return {
            bind(route) {
              return {
                first: async () => ({
                  id: 'page_work',
                  route_path: '/work',
                  slug: 'work',
                  status: 'published',
                }),
              };
            },
          };
        }
        return {
          bind(pageId) {
            return {
              all: async () => ({
                results: [
                  {
                    id: 'sec_w1',
                    section_type: 'hero',
                    section_name: 'hero',
                    section_data: JSON.stringify({ headline: 'legacy-d1' }),
                    sort_order: 10,
                    is_visible: 1,
                    published_r2_key: null,
                  },
                ],
              }),
            };
          },
        };
      },
    },
  };

  const bundle = await loadPublishedCmsSectionsByRoute(env, '/work');
  assert.equal(bundle.source, 'd1_fallback');
  assert.equal(bundle.sections[0].section_data.headline, 'legacy-d1');
});
