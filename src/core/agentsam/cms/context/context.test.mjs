import assert from 'node:assert/strict';
import {
  normalizeCmsSitesResponse,
  readBootstrapCmsProjectSlug,
  resolveCmsProjectSlug,
  sortSitesForWorkspace,
} from './workspace-context.js';
import { sortCmsHubSites } from './hub-sites.js';
import { selectCmsSiteFromWorkspaceContext } from './site-context.js';
import * as canonical from './index.js';
import * as legacyWorkspace from '../../../cms-workspace-resolve.js';
import * as legacyHub from '../../../cms-hub-sites.js';
import * as legacyAccess from '../../../cms-access.js';
import * as legacyTenant from '../../../cms-tenant-resolve.js';

const sites = [
  { slug: 'site-b', name: 'Beta', source: 'cms_tenants', hub_priority: 2 },
  { slug: 'site-a', name: 'Alpha', source: 'agentsam_project_context', hub_priority: 5 },
];

assert.deepEqual(normalizeCmsSitesResponse({ a: sites[0], b: sites[1] }), sites);
assert.equal(readBootstrapCmsProjectSlug({ ui_preferences_json: '{"cms_project_slug":"site-a"}' }), 'site-a');
assert.equal(readBootstrapCmsProjectSlug({ runtime_status_json: '{"cms_project_slug":"site-b"}' }), 'site-b');

const explicit = await resolveCmsProjectSlug(null, {
  tenantId: 'tenant-test',
  workspaceId: 'ws-test',
  explicitSlug: 'site-b',
  sites,
});
assert.equal(explicit.project_slug, 'site-b');
assert.equal(explicit.resolved_from, 'query.project_slug');

const ambiguous = await resolveCmsProjectSlug(null, {
  tenantId: 'tenant-test',
  workspaceId: 'ws-test',
  sites,
});
assert.equal(ambiguous.project_slug, null);
assert.equal(ambiguous.resolved_from, 'ambiguous_requires_site');

const single = await resolveCmsProjectSlug(null, {
  tenantId: 'tenant-test',
  workspaceId: 'ws-test',
  sites: [sites[0]],
});
assert.equal(single.project_slug, 'site-b');
assert.equal(single.resolved_from, 'single_site_for_scope');

const ordered = await sortSitesForWorkspace(null, sites, { primarySlug: 'site-b', workspaceSlug: 'anything' });
assert.equal(ordered[0].slug, 'site-b');

const hubOrdered = sortCmsHubSites(sites);
assert.equal(hubOrdered[0].slug, 'site-a');

const selected = selectCmsSiteFromWorkspaceContext({ project_slug: 'site-a', sites });
assert.equal(selected?.slug, 'site-a');
assert.equal(selectCmsSiteFromWorkspaceContext({ project_slug: null, sites }), null);

// Old import paths must now resolve to the exact canonical functions, not copied logic.
assert.equal(legacyWorkspace.resolveCmsWorkspaceContext, canonical.resolveCmsWorkspaceContext);
assert.equal(legacyWorkspace.listCmsSitesForScope, canonical.listCmsSitesForScope);
assert.equal(legacyHub.sortCmsHubSites, canonical.sortCmsHubSites);
assert.equal(legacyAccess.cmsPageInScope, canonical.cmsPageInScope);
assert.equal(legacyTenant.resolveCmsTenantByProjectSlug, canonical.resolveCmsTenantByProjectSlug);
assert.equal(legacyTenant.cmsTenantPublicDomain, canonical.cmsTenantPublicDomain);

const scope = {
  workspaceId: 'ws-test',
  authTenantId: 'tenant-test',
  allowedSlugs: new Set(['site-a']),
  sites: [{ slug: 'site-a', source: 'agentsam_project_context' }],
  registryMode: true,
};
assert.equal(canonical.cmsPageInScope({ project_slug: 'site-a', workspace_id: 'ws-test' }, scope), true);
assert.equal(canonical.cmsPageInScope({ project_slug: 'site-a', workspace_id: 'ws-other' }, scope), false);
assert.equal(canonical.cmsPageInScope({ project_slug: 'site-b', workspace_id: 'ws-test' }, scope), false);

const listQuery = canonical.buildCmsPagesListQuery(scope, 'site-a');
assert.match(listQuery.sql, /workspace_id = \?/);
assert.deepEqual(listQuery.binds, ['ws-test', 'site-a']);

console.log('cms-context tests: OK');
