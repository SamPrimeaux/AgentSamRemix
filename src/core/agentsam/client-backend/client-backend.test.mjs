import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalSourceAssetId,
  normalizeMediaAsset,
  normalizeMediaAssetUsage,
  normalizeSourceUrl,
  parseSrcsetCandidates,
  validateWebsiteIngestRequest,
} from './index.js';

test('srcset parser keeps commas inside Wix transformation URLs', () => {
  const a = 'https://static.wixstatic.com/media/abc123~mv2.jpg/v1/fill/w_640,h_480,q_85/foo.jpg';
  const b = 'https://static.wixstatic.com/media/abc123~mv2.jpg/v1/fill/w_1280,h_960,q_90/foo.jpg';
  assert.deepEqual(parseSrcsetCandidates(`${a} 640w, ${b} 1280w`), [
    { url: a, descriptor: '640w' },
    { url: b, descriptor: '1280w' },
  ]);
});

test('srcset parser supports descriptorless candidates', () => {
  assert.deepEqual(parseSrcsetCandidates('a.jpg, b.jpg'), [
    { url: 'a.jpg', descriptor: null },
    { url: 'b.jpg', descriptor: null },
  ]);
});

test('Wix responsive variants share a pre-download source identity', () => {
  const a = 'https://static.wixstatic.com/media/abc123~mv2.jpg/v1/fill/w_640,h_480,q_85/foo.jpg';
  const b = 'https://static.wixstatic.com/media/abc123~mv2.jpg/v1/fill/w_1280,h_960,q_90/foo.jpg';
  assert.equal(canonicalSourceAssetId(a), 'wix:abc123~mv2.jpg');
  assert.equal(canonicalSourceAssetId(a), canonicalSourceAssetId(b));
});

test('GoDaddy responsive variants share a pre-download source identity', () => {
  const a = 'https://img1.wsimg.com/isteam/ip/abc/logo.png/:/rs=w:400,h:300,cg:true/m/cr=w:400,h:300';
  const b = 'https://img1.wsimg.com/isteam/ip/abc/logo.png/:/rs=w:1200,h:900,cg:true/m/cr=w:1200,h:900';
  assert.equal(canonicalSourceAssetId(a), canonicalSourceAssetId(b));
});

test('source URL normalization strips tracking but preserves meaningful query parameters', () => {
  assert.equal(
    normalizeSourceUrl('https://example.com/a.jpg?utm_source=test&v=2#frag'),
    'https://example.com/a.jpg?v=2',
  );
});

test('Asset identity is separate from repeated AssetUsage context', () => {
  const asset = normalizeMediaAsset(
    {
      id: 'asset_1',
      bucket: 'client-media',
      object_key: 'assets/original/abc.jpg',
      content_type: 'image/jpeg',
      width: 1200,
      height: 800,
      checksum_sha256: 'a'.repeat(64),
    },
    { tenantId: 'tenant_1', workspaceId: 'ws_1' },
  );
  const usageA = normalizeMediaAssetUsage(
    { asset_id: asset.id, page_url: 'https://example.com/', alt: 'Hero' },
    { tenantId: 'tenant_1', workspaceId: 'ws_1' },
  );
  const usageB = normalizeMediaAssetUsage(
    { asset_id: asset.id, page_url: 'https://example.com/about', alt: 'Project photo' },
    { tenantId: 'tenant_1', workspaceId: 'ws_1' },
  );
  assert.equal(asset.aspect_ratio, 1.5);
  assert.equal(usageA.asset_id, usageB.asset_id);
  assert.notEqual(usageA.page_url, usageB.page_url);
});

test('website ingest contract defaults to safe reusable migration policy', () => {
  const result = validateWebsiteIngestRequest({
    tenant: 'tenant_1',
    workspace_id: 'ws_1',
    site: 'https://example.com',
    destination: { bucket: 'client-media' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.request.crawl_policy.same_domain, true);
  assert.equal(result.request.crawl_policy.respect_robots_txt, true);
  assert.equal(result.request.asset_policy.preserve_original, true);
  assert.equal(result.request.asset_policy.exact_hash, 'sha256');
  assert.equal(result.request.asset_policy.enrichment.enabled, false);
  assert.equal(result.request.destination.provider, 'r2');
});
