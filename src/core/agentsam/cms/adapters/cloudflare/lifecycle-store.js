import { cmsBootstrapKey } from '../../bootstrap/cache-key.js';
import { getCmsR2Binding } from './storage.js';

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return null; }
}
function draftKey(pageId,userId){ return `cms:draft:${String(pageId)}:${String(userId)}`; }
async function copyObject(binding, sourceKey, destKey) {
  if (!binding || !sourceKey || !destKey) return false;
  const obj = await binding.get(String(sourceKey)).catch(()=>null);
  if (!obj) return false;
  const buf = await obj.arrayBuffer();
  await binding.put(String(destKey), buf, { httpMetadata:{ contentType: obj.httpMetadata?.contentType || 'text/html' } });
  return true;
}

export function createCloudflareCmsLifecycleStore(env) {
  const db = env?.DB;
  if (!db?.prepare) throw new TypeError('D1 database binding required');
  return {
    async putHotDraft(pageId,userId,payload) {
      const kv=env?.SESSION_CACHE; if(!kv) return;
      await kv.put(draftKey(pageId,userId), JSON.stringify({draft_data:payload,...payload,cached_at:Math.floor(Date.now()/1000)}), {expirationTtl:1800}).catch(()=>{});
    },
    async putHotDraftEnvelope(pageId,userId,envelope) {
      const kv=env?.SESSION_CACHE; if(!kv) return;
      await kv.put(draftKey(pageId,userId),JSON.stringify({...envelope,cached_at:Math.floor(Date.now()/1000)}),{expirationTtl:1800}).catch(()=>{});
    },
    async getHotDraft(pageId,userId) {
      const kv=env?.SESSION_CACHE; if(!kv) return null;
      const raw=await kv.get(draftKey(pageId,userId)).catch(()=>null);
      const parsed=parseJson(raw); return parsed?.draft_data || parsed;
    },
    async deleteHotDraft(pageId,userId) { await env?.SESSION_CACHE?.delete(draftKey(pageId,userId)).catch(()=>{}); },
    async getDurableDraft(pageId,userId) {
      const row=await db.prepare(`SELECT draft_data,updated_at FROM cms_page_drafts WHERE page_id=? AND user_id=? LIMIT 1`).bind(pageId,userId).first().catch(()=>null);
      return row ? {draftData:parseJson(row.draft_data),updatedAt:row.updated_at||null} : {draftData:null,updatedAt:null};
    },
    async getDraftRecord(pageId,userId) {
      const hot=await this.getHotDraft(pageId,userId);
      if(hot) return {draftData:hot,source:'kv',updatedAt:null};
      const durable=await this.getDurableDraft(pageId,userId);
      return {draftData:durable.draftData,source:durable.draftData?'d1':null,updatedAt:durable.updatedAt};
    },
    async putDurableDraft(pageId,userId,payload) {
      await db.prepare(`INSERT INTO cms_page_drafts (page_id,user_id,draft_data,created_at,updated_at)
        VALUES (?,?,?,datetime('now'),datetime('now'))
        ON CONFLICT(page_id,user_id) DO UPDATE SET draft_data=excluded.draft_data,updated_at=datetime('now')`)
        .bind(pageId,userId,JSON.stringify(payload)).run();
    },
    async deleteDurableDraft(pageId,userId) { await db.prepare(`DELETE FROM cms_page_drafts WHERE page_id=? AND user_id=?`).bind(pageId,userId).run(); },
    async ensurePagePublishMetadata(pageId,page,projectSlug) {
      const updates={};
      if(!String(page?.seo_title||'').trim()&&String(page?.title||'').trim()) {
        updates.seo_title=String(page.title).trim();
        await db.prepare(`UPDATE cms_pages SET seo_title=? WHERE id=?`).bind(updates.seo_title,pageId).run();
      }
      if(!String(page?.meta_description||'').trim()) {
        updates.meta_description=`${String(page?.title||page?.slug||'Page').trim()} — ${projectSlug||'site'}`;
        await db.prepare(`UPDATE cms_pages SET meta_description=? WHERE id=?`).bind(updates.meta_description,pageId).run();
      }
      return updates;
    },
    async commitPublishedPage(input) {
      await db.prepare(`UPDATE cms_pages SET status='published',published_at=?,published_by=?,updated_at=?,r2_key=?,content_size_bytes=? WHERE id=?`)
        .bind(input.now,input.userId,input.now,input.r2Key,Number(input.byteLength)||0,input.pageId).run();
    },
    async commitContentDraftMetadata(input) {
      await db.prepare(`UPDATE cms_pages SET title=COALESCE(?,title),updated_by=?,updated_at=?,r2_key=?,content_size_bytes=?,status=? WHERE id=?`)
        .bind(input.title||null,input.userId,input.now,input.r2Key,Number(input.byteLength)||0,input.status,input.pageId).run();
    },
    async getTenantDomain(projectSlug) {
      const row=await db.prepare(`SELECT domain FROM cms_tenants WHERE slug=? LIMIT 1`).bind(String(projectSlug||'')).first().catch(()=>null);
      return row?.domain||null;
    },
    async acquirePublishLock(workspaceId,projectSlug,userId) {
      const kv=env?.SESSION_CACHE; if(!kv) return {acquired:true};
      const key=`cms:publish-lock:${String(workspaceId||'').trim()}:${String(projectSlug||'').trim()}`;
      const uid=String(userId||'').trim(); const existing=await kv.get(key).catch(()=>null);
      if(existing) {
        try { const parsed=JSON.parse(existing); if(parsed?.user_id && parsed.user_id!==uid) return {acquired:false,holder:String(parsed.user_id)}; }
        catch { if(existing!==uid) return {acquired:false,holder:String(existing)}; }
      }
      await kv.put(key,JSON.stringify({user_id:uid,at:Math.floor(Date.now()/1000)}),{expirationTtl:120}).catch(()=>{});
      return {acquired:true};
    },
    async releasePublishLock(workspaceId,projectSlug,userId) {
      const kv=env?.SESSION_CACHE; if(!kv) return;
      const key=`cms:publish-lock:${String(workspaceId||'').trim()}:${String(projectSlug||'').trim()}`;
      const uid=String(userId||'').trim(); const existing=await kv.get(key).catch(()=>null); if(!existing)return;
      try { const parsed=JSON.parse(existing); if(parsed?.user_id===uid) await kv.delete(key).catch(()=>{}); }
      catch { if(existing===uid) await kv.delete(key).catch(()=>{}); }
    },
    async invalidateBootstrap(workspaceId,projectSlug) {
      const kv=env?.SESSION_CACHE; if(!kv)return;
      await kv.delete(cmsBootstrapKey(String(workspaceId||'').trim(),String(projectSlug||'').trim())).catch(()=>{});
    },
    async listArtifactRevisions(pageId,limit=20) {
      const {results}=await db.prepare(`SELECT id,page_id,slug,previous_r2_key,deployed_html_hash,created_at FROM cms_live_rollbacks WHERE page_id=? ORDER BY created_at DESC LIMIT ?`).bind(pageId,Math.max(1,Math.min(100,Number(limit)||20))).all();
      return results||[];
    },
    async createArtifactRevision(input) {
      const page=input.page||{};
      const ts=Number(input.createdAt||Math.floor(Date.now()/1000));
      const projectId=String(page.project_id||page.project_slug||'').trim();
      const workspaceId=String(input.workspaceId||page.workspace_id||'').trim();
      const bucket=String(page.r2_bucket||input.r2Bucket||'cms');
      const id=String(input.id||`rb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`);
      let artifactKey=String(page.r2_key||''); let hash='';
      if (artifactKey) {
        const binding=getCmsR2Binding(env,bucket);
        if (binding) {
          const head=await binding.head(artifactKey).catch(()=>null);
          hash=head?.etag ? String(head.etag).replace(/"/g,'') : '';
          const snapshotKey=`cms/${workspaceId}/${projectId}/${page.slug}/snapshots/${ts}-${id}.html`;
          if (await copyObject(binding,artifactKey,snapshotKey)) artifactKey=snapshotKey;
        }
      }
      await db.prepare(`INSERT INTO cms_live_rollbacks (id,page_id,project_id,slug,previous_r2_key,deployed_html_hash,created_at) VALUES (?,?,?,?,?,?,?)`)
        .bind(id,page.id,projectId,page.slug,artifactKey,hash,ts).run();
      return {id,page_id:page.id,previous_r2_key:artifactKey,deployed_html_hash:hash,created_at:ts,source:'artifact'};
    },
    async restoreArtifactRevision(input) {
      const page=input.page||{};
      const revision=await db.prepare(`SELECT * FROM cms_live_rollbacks WHERE id=? AND page_id=? LIMIT 1`).bind(String(input.revisionId),String(page.id)).first().catch(()=>null);
      if(!revision) return {ok:false,error:'revision_not_found'};
      const bucket=String(page.r2_bucket||input.r2Bucket||'cms');
      const binding=getCmsR2Binding(env,bucket);
      let restoredKey=revision.previous_r2_key;
      if (binding && revision.previous_r2_key && input.publishedKey) {
        if (await copyObject(binding,revision.previous_r2_key,input.publishedKey)) restoredKey=input.publishedKey;
      }
      const now=Number(input.now||Math.floor(Date.now()/1000));
      await db.prepare(`UPDATE cms_pages SET r2_key=?,status='published',published_at=?,updated_at=? WHERE id=?`).bind(restoredKey,now,now,page.id).run();
      return {ok:true,revision:{...revision,source:'artifact'},restored_r2_key:restoredKey,r2_restored:restoredKey===input.publishedKey};
    },
    async upsertOverrideDraft(input) {
      const existing=await db.prepare(`SELECT id,version FROM cms_page_overrides WHERE project_slug=? AND path=? AND section=? LIMIT 1`).bind(input.projectSlug,input.path,input.section).first().catch(()=>null);
      let id=existing?.id;
      if(id) {
        await db.prepare(`UPDATE cms_page_overrides SET overrides_json=?,status='draft',version=?,updated_at=datetime('now'),project_slug=? WHERE id=?`).bind(input.payload,Number(existing.version)||1,input.projectSlug,id).run();
      } else {
        id=`ov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
        await db.prepare(`INSERT INTO cms_page_overrides (id,project_id,project_slug,path,section,overrides_json,status,version,created_by,created_at,updated_at,project_id_text) VALUES (?,?,?,?,?,?,'draft',1,?,datetime('now'),datetime('now'),?)`).bind(id,input.projectId,input.projectSlug,input.path,input.section,input.payload,input.userId,input.projectIdText).run().catch(async()=>{
          await db.prepare(`INSERT INTO cms_page_overrides (id,project_id,project_slug,path,section,overrides_json,status,version,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,'draft',1,?,datetime('now'),datetime('now'))`).bind(id,input.projectId,input.projectSlug,input.path,input.section,input.payload,input.userId).run();
        });
      }
      return {id,isNew:!existing?.id};
    },
    async publishOverrideRevision(overrideId,actor={}) {
      const row=await db.prepare(`SELECT * FROM cms_page_overrides WHERE id=? LIMIT 1`).bind(overrideId).first().catch(()=>null);
      if(!row) return {ok:false,error:'override_not_found'};
      const version=actor.useCurrentVersion===true ? Math.max(1,Number(row.version)||1) : (Number(row.version)||0)+1;
      const id=`ovv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
      await db.prepare(`INSERT INTO cms_override_versions (override_id,project_id,project_slug,path,section,overrides_json,version,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,'published',?,datetime('now'))`)
        .bind(overrideId,row.project_id,row.project_slug,row.path,row.section,row.overrides_json,version,actor.userId||null).run();
      await db.prepare(`UPDATE cms_page_overrides SET status='published',version=?,published_at=datetime('now'),published_by=?,updated_at=datetime('now') WHERE id=?`).bind(version,actor.userId||null,overrideId).run();
      return {ok:true,override_id:overrideId,version_id:id,version,project_slug:row.project_slug,revision:{id,override_id:overrideId,version,status:'published',created_by:actor.userId||null,source:'override'}};
    },
  };
}
