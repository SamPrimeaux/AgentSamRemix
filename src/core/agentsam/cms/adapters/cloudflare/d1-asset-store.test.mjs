import assert from 'node:assert/strict';
import { createD1CmsAssetStore } from './d1-asset-store.js';

function fakeDb(columnNames) {
  const calls = [];
  const row = { id:'a1', tenant_id:'t1', filename:'hero.png', original_filename:'hero.png', path:'cms/hero.png', size:12, mime_type:'image/png', category:'image', r2_key:'cms/hero.png', public_url:'https://x/hero.png' };
  return {
    calls,
    prepare(sql) {
      const state = { sql, binds: [] };
      calls.push(state);
      return {
        bind(...args) { state.binds = args; return this; },
        async all() {
          if (sql.startsWith('PRAGMA table_info')) return { results: columnNames.map((name, cid) => ({ cid, name })) };
          if (sql.includes('FROM cms_collection_assets')) return { results: [{ collection_id:'c1', asset_id:'a1', order_index:0, added_at:1, ...row }] };
          return { results: [row] };
        },
        async first() {
          if (sql.includes('metadata_value')) return { metadata_value: '{"existing":true}' };
          return row;
        },
        async run() { return { success: true }; },
      };
    },
  };
}

const expandedCols = ['id','tenant_id','filename','original_filename','path','size','mime_type','category','tags','r2_key','public_url','thumbnail_url','metadata','created_at','updated_at','is_live','r2_bucket','alt_text','usage_context','asset_key','label'];
const expandedDb = fakeDb(expandedCols);
const expandedStore = createD1CmsAssetStore(expandedDb);
assert.equal((await expandedStore.list({ tenantId:'t1' })).length, 1);
await expandedStore.insert({ id:'new', tenant_id:'t1', name:'x.png', original_name:'x.png', path:'cms/x.png', size_bytes:2, mime_type:'image/png', category:'image', tags:[], storage:{bucket:'cms',key:'cms/x.png'}, urls:{}, metadata:{}, is_live:false });
const insertSql = expandedDb.calls.find((c) => c.sql.startsWith('INSERT INTO cms_assets'))?.sql || '';
assert.match(insertSql, /filename/);
assert.match(insertSql, /public_url/);
await expandedStore.update('a1', { label:'Hero', usage_context:'header' });
assert.ok(expandedDb.calls.some((c) => c.sql.startsWith('UPDATE cms_assets')));
assert.equal((await expandedStore.listCollection({ tenantId:'t1' }, 'c1')).length, 1);

const compactCols = ['id','tenant_id','workspace_id','project_slug','file_name','r2_bucket','r2_key','mime_type','size_bytes','alt_text','metadata_json','created_at','updated_at'];
const compactDb = fakeDb(compactCols);
const compactStore = createD1CmsAssetStore(compactDb);
await compactStore.update('a1', { label:'Logo', usage_context:'header', is_live:true });
assert.ok(compactDb.calls.some((c) => c.sql.includes('metadata_json AS metadata_value')));
const compactUpdate = compactDb.calls.find((c) => c.sql.startsWith('UPDATE cms_assets'));
assert.match(compactUpdate.sql, /metadata_json = \?/);
console.log('cms-d1-asset-store tests: OK');
