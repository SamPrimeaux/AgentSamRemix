import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CMS_PUBLIC_MANIFEST_PILOT_ROUTES,
  backfillCmsPublicManifestPilotRoutes,
  findPublishedCmsPageByRoute,
} from './public-manifest-backfill.js';

test('CMS_PUBLIC_MANIFEST_PILOT_ROUTES covers IAM home and two marketing routes', () => {
  assert.deepEqual(CMS_PUBLIC_MANIFEST_PILOT_ROUTES, ['/', '/agentsam', '/about']);
});

test('findPublishedCmsPageByRoute reads published page row', async () => {
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(route) {
            assert.equal(route, '/about');
            return {
              first: async () => ({
                id: 'page_about',
                route_path: '/about',
                slug: 'about',
                status: 'published',
              }),
            };
          },
        };
      },
    },
  };
  const page = await findPublishedCmsPageByRoute(env, '/about');
  assert.equal(page?.id, 'page_about');
});

test('backfill dry-run reports would_publish when manifest missing', async () => {
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(route) {
            return {
              first: async () => ({
                id: 'page_home',
                route_path: route,
                slug: route === '/' ? 'home' : route.slice(1),
                status: 'published',
                published_manifest_r2_key: null,
              }),
            };
          },
        };
      },
    },
    SESSION_CACHE: {
      get: async () => null,
    },
  };
  const report = await backfillCmsPublicManifestPilotRoutes(env, {
    routes: ['/'],
    dryRun: true,
  });
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].route, '/');
  assert.equal(report.results[0].dry_run, true);
  assert.equal(report.results[0].would_publish, true);
});
