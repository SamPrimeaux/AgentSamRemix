/** Host-specific CMS draft artifact preparation. Portable lifecycle sequencing lives under agentsam/cms/. */
import { createCloudflareCmsLifecycleStore } from './agentsam/cms/adapters/cloudflare/lifecycle-store.js';
import { createCloudflareCmsPreviewStore } from './agentsam/cms/adapters/cloudflare/preview-store.js';
import { CMS_DEFAULT_R2_BUCKET, getCmsR2Binding } from './agentsam/cms/adapters/cloudflare/storage.js';
import {
  buildCmsPreviewModel,
  cmsPreviewModelToLegacy,
  loadCmsPreviewByPageId,
  renderCmsPreviewFallbackHtml,
} from './agentsam/cms/preview/index.js';
import {
  isFullHtmlDocument,
  normalizeFullPageHtml,
  renderCmsSectionTreeHtmlWithInjections,
} from './cms-injected-sections.js';
import { resolveIamPageHtmlKeys, resolveIamStorefrontAssetForPage } from './iam-storefront-assets.js';

function cmsPageHtmlKey(workspaceId, projectId, slug, variant) {
  return `cms/${workspaceId}/${projectId}/${slug}/${variant}.html`;
}
async function resolvePreviewContext(env,pageId,userId,draftData=null) {
  const model=await loadCmsPreviewByPageId(pageId,{previewMode:'draft',userId,draftData},createCloudflareCmsPreviewStore(env));
  return model?cmsPreviewModelToLegacy(model):null;
}
async function resolveFullPageHtmlFromSections(sections,r2Binding) {
  const visible=(sections||[]).filter((s)=>s.is_visible===1||s.is_visible===true);
  if(visible.length!==1||!r2Binding)return null;
  const section=visible[0];
  const data=section.section_data&&typeof section.section_data==='object'?section.section_data:(()=>{try{return typeof section.section_data==='string'?JSON.parse(section.section_data):{}}catch{return{}}})();
  const r2Key=String(data.r2_key||data.r2Key||'').trim(); if(!r2Key)return null;
  const obj=await r2Binding.get(r2Key).catch(()=>null); if(!obj)return null;
  const raw=await obj.text(); return isFullHtmlDocument(raw)?normalizeFullPageHtml(raw):null;
}
function renderFallback(sections,componentsBySection){
  const model=buildCmsPreviewModel({page:{id:'__draft__',route_path:'/',slug:'home',status:'draft',page_type:'home'},sections,blocksBySection:componentsBySection,previewMode:'draft',userId:'__renderer__'});
  return renderCmsPreviewFallbackHtml(model);
}

export async function writeCmsDraftHtmlToR2(env,opts) {
  const workspaceId=String(opts.workspaceId||'').trim(), userId=String(opts.userId||'').trim();
  const page=opts.page||{}, pageId=String(page.id||'').trim();
  if(!env?.DB||!workspaceId||!userId||!pageId)return{ok:false,error:'missing_context'};
  const ctx=await resolvePreviewContext(env,pageId,userId,opts.draftData||null); if(!ctx)return{ok:false,error:'page_not_found'};
  const layout=resolveIamPageHtmlKeys(page,workspaceId,cmsPageHtmlKey);
  const asset=resolveIamStorefrontAssetForPage(page);
  const r2Bucket=layout.bucket||String(page.r2_bucket||CMS_DEFAULT_R2_BUCKET).trim();
  const r2Binding=getCmsR2Binding(env,r2Bucket); if(!r2Binding)return{ok:false,error:'r2_unavailable'};
  const fullPageOverride=typeof opts.fullPageHtml==='string'&&opts.fullPageHtml.trim()?normalizeFullPageHtml(opts.fullPageHtml):await resolveFullPageHtmlFromSections(ctx.sections,r2Binding);
  const lifecycleStore=createCloudflareCmsLifecycleStore(env);
  if(asset?.hydrate&&!fullPageOverride){
    await lifecycleStore.putHotDraftEnvelope(pageId,userId,{draft_data:ctx.draftData||opts.draftData||null,r2_bucket:r2Bucket,byte_length:0,html_rendered_at:Math.floor(Date.now()/1000),storefront_hydrate_sections:true});
    return{ok:true,skipped_r2:true,reason:'storefront_hydrate_sections',edit_mode:'storefront_asset'};
  }
  const html=fullPageOverride || (ctx.sections?.length?await renderCmsSectionTreeHtmlWithInjections(ctx.sections,ctx.componentsBySection,r2Binding):renderFallback(ctx.sections,ctx.componentsBySection));
  const draftKey=layout.draft_key, contentBuffer=new TextEncoder().encode(html);
  await r2Binding.put(draftKey,contentBuffer,{httpMetadata:{contentType:String(page.content_type||'text/html')}});
  if(layout.mode==='storefront_asset'&&layout.legacy_draft_key&&isFullHtmlDocument(html)) await r2Binding.put(layout.legacy_draft_key,contentBuffer,{httpMetadata:{contentType:String(page.content_type||'text/html')}}).catch(()=>{});
  await lifecycleStore.putHotDraftEnvelope(pageId,userId,{draft_data:ctx.draftData||opts.draftData||null,r2_key:draftKey,r2_bucket:r2Bucket,byte_length:contentBuffer.byteLength,html_rendered_at:Math.floor(Date.now()/1000),full_page_document:Boolean(fullPageOverride)});
  return{ok:true,r2_key:draftKey,r2_bucket:r2Bucket,byte_length:contentBuffer.byteLength};
}

export async function ensureCmsDraftR2BeforePublish(env,opts) {
  const r2Binding=opts.r2Binding,draftKey=String(opts.draftKey||'').trim(),page=opts.page||{};
  const userId=String(opts.userId||'').trim(),pageId=String(page.id||'').trim(),workspaceId=String(opts.workspaceId||'').trim();
  const layout=resolveIamPageHtmlKeys(page,workspaceId,cmsPageHtmlKey),asset=resolveIamStorefrontAssetForPage(page);
  if(asset?.hydrate){
    if(r2Binding&&draftKey&&await r2Binding.head(draftKey).catch(()=>null))return{ok:true,existed:true,r2_key:draftKey};
    return{ok:true,skipped_r2:true,reason:'storefront_hydrate_sections'};
  }
  if(pageId&&env?.DB){
    const sections=await createCloudflareCmsPreviewStore(env).listSections(pageId).catch(()=>[]);
    if(sections.length>0)return writeCmsDraftHtmlToR2(env,{workspaceId,page,userId});
  }
  if(r2Binding&&draftKey&&await r2Binding.head(draftKey).catch(()=>null))return{ok:true,existed:true,r2_key:draftKey};
  const publishedKey=layout.published_key||String(page.r2_key||'').trim();
  if(r2Binding&&draftKey&&publishedKey&&pageId&&userId){
    const pubObj=await r2Binding.get(publishedKey).catch(()=>null);
    if(pubObj){
      const content=await pubObj.arrayBuffer(),r2Bucket=layout.bucket||String(page.r2_bucket||CMS_DEFAULT_R2_BUCKET).trim();
      await r2Binding.put(draftKey,content,{httpMetadata:{contentType:String(page.content_type||'text/html; charset=utf-8')}});
      await createCloudflareCmsLifecycleStore(env).putHotDraftEnvelope(pageId,userId,{r2_key:draftKey,r2_bucket:r2Bucket,byte_length:content.byteLength,copied_from_published:publishedKey,html_rendered_at:Math.floor(Date.now()/1000)});
      return{ok:true,copied_from_published:true,r2_key:draftKey};
    }
  }
  return writeCmsDraftHtmlToR2(env,{workspaceId:opts.workspaceId,page,userId});
}

export async function saveCmsPageContentDraft(env, opts) {
  const workspaceId=String(opts.workspaceId||'').trim(), userId=String(opts.userId||'').trim();
  const page=opts.page||{}, pageId=String(page.id||'').trim();
  if(!env?.DB||!workspaceId||!userId||!pageId)return{ok:false,error:'missing_context'};
  const contentType=String(opts.contentType||'text/html');
  const layout=resolveIamPageHtmlKeys(page,workspaceId,cmsPageHtmlKey);
  const r2Bucket=String(layout.bucket||page.r2_bucket||CMS_DEFAULT_R2_BUCKET);
  const r2Key=layout.draft_key, binding=getCmsR2Binding(env,r2Bucket);
  if(!binding)return{ok:false,error:'R2 storage unavailable'};
  const buffer=new TextEncoder().encode(opts.content||'');
  await binding.put(r2Key,buffer,{httpMetadata:{contentType}});
  if(layout.mode==='storefront_asset'&&layout.legacy_draft_key) await binding.put(layout.legacy_draft_key,buffer,{httpMetadata:{contentType}}).catch(()=>{});
  const lifecycleStore=createCloudflareCmsLifecycleStore(env);
  await lifecycleStore.putHotDraftEnvelope(pageId,userId,{content_type:contentType,r2_key:r2Key,r2_bucket:r2Bucket,title:opts.title||null,byte_length:buffer.byteLength});
  const now=Math.floor(Date.now()/1000), wasPublished=String(page.status||'').trim().toLowerCase()==='published';
  const publishedKey=layout.published_key;
  const dbR2Key=layout.mode==='storefront_asset'?publishedKey:(wasPublished?publishedKey:r2Key);
  const nextStatus=wasPublished?'published':'draft';
  await lifecycleStore.commitContentDraftMetadata({pageId,userId,now,title:opts.title||null,r2Key:dbR2Key,byteLength:buffer.byteLength,status:nextStatus});
  const projectSlug=String(page.project_slug||page.project_id||'').trim();
  if(projectSlug) await lifecycleStore.invalidateBootstrap(workspaceId,projectSlug);
  return {ok:true,r2_key:r2Key,draft_r2_key:r2Key,live_r2_key:wasPublished?publishedKey:r2Key,status:nextStatus,has_unpublished_draft:wasPublished,kv_draft_key:`cms:draft:${pageId}:${userId}`};
}
