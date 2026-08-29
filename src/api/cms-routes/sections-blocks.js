import { jsonResponse } from '../../core/responses.js';
import {
  applyCmsFieldValuesToHtml, applyEditorFieldValues, CMS_SECTION_INJECT_META_KEYS, createCmsSection,
  extractCmsFieldMarkersFromHtml, flattenSectionDataForEditor, getCmsSection, listCmsSections,
  normalizeSectionDataForWrite, removeCmsSection, reorderCmsSections, sectionToLegacyRow,
  setCmsSectionVisibility, updateCmsSection,
} from '../../core/agentsam/cms/sections/index.js';
import {
  blockToLegacyRow, createCmsBlock, listCmsBlocks, removeCmsBlock, reorderCmsBlocks,
  setCmsBlockVisibility, updateCmsBlock,
} from '../../core/agentsam/cms/blocks/index.js';
import { CMS_DEFAULT_R2_BUCKET, getCmsR2Binding } from '../../core/agentsam/cms/adapters/cloudflare/storage.js';
import { auditCmsMutation, flushCmsDraftToD1, invalidateCmsBootstrap, logCmsActivity, stageCmsDraftKv } from '../../core/cms-edit-safety.js';
import { logPromptCacheUsage } from '../../core/prompt-cache-economics.js';
import { cmsContentSha256, cmsMutationMeta, cmsR2PublicUrlFromRequest, cmsSectionHtmlKey, presignR2GetObjectUrl } from './route-utils.js';

export async function handleCmsSectionBlockRoutes(state) {
  const { path, method, url, request, env, ctx, authUser, tenantId, workspaceId, cmsScope, pageStore, sectionStore, blockStore, host } = state;
  if (path === '/api/cms/sections' && method === 'GET') {
    const pageId=String(url.searchParams.get('page_id')||'').trim(); if(!pageId)return jsonResponse({error:'page_id is required'},400);
    try { const r=await listCmsSections(cmsScope,pageId,pageStore,sectionStore); if(!r.ok)return jsonResponse({error:r.error},r.status||400); return jsonResponse({page:r.page,sections:r.sections.map(sectionToLegacyRow)}); }
    catch(e){return jsonResponse({error:e.message},500)}
  }
  const fields=path.match(/^\/api\/cms\/sections\/([^/]+)\/editable-fields$/);
  if(fields&&method==='GET'){
    try{
      const scoped=await getCmsSection(cmsScope,fields[1],pageStore,sectionStore); if(!scoped.ok)return jsonResponse({error:scoped.error},scoped.status||404);
      const row=sectionToLegacyRow(scoped.section), data=scoped.section.data||{}, typed=flattenSectionDataForEditor(data), r2Key=String(data.r2_key||'').trim(), htmlSource=String(data.html_source||'').trim(); let fragment=[];
      const bucket=String(data.r2_bucket||scoped.page?.r2_bucket||CMS_DEFAULT_R2_BUCKET).trim(), binding=getCmsR2Binding(env,bucket);
      if((r2Key||htmlSource==='injected')&&binding&&r2Key){const obj=await binding.get(r2Key).catch(()=>null); if(obj)fragment=extractCmsFieldMarkersFromHtml(await obj.text());}
      return jsonResponse({section_id:fields[1],section_name:row.section_name,section_type:row.section_type,html_source:htmlSource||null,r2_key:r2Key||null,fields:[...typed,...fragment],inject_meta:Object.fromEntries(Object.entries(data).filter(([k])=>CMS_SECTION_INJECT_META_KEYS.has(k))) });
    }catch(e){return jsonResponse({error:e.message},500)}
  }
  const sectionMatch=path.match(/^\/api\/cms\/sections\/([^/]+)$/);
  if(sectionMatch&&method==='PUT'){
    let body={}; try{body=await request.json()}catch{return jsonResponse({error:'Invalid JSON body'},400)}
    const sectionData=body.section_data??body.sectionData, hasData=sectionData!=null, metaFields=['section_name','section_type','sort_order','is_visible','css_classes','custom_css'];
    if(!hasData&&!metaFields.some((k)=>k in body))return jsonResponse({error:'section_data or section metadata required'},400);
    try{
      const scoped=await getCmsSection(cmsScope,sectionMatch[1],pageStore,sectionStore); if(!scoped.ok)return jsonResponse({error:scoped.error},scoped.status||404);
      const row=sectionToLegacyRow(scoped.section), page=scoped.page; let parsed=scoped.section.data||{};
      if(hasData){
        parsed=typeof sectionData==='string'?(()=>{try{return JSON.parse(sectionData)}catch{return{raw:sectionData}}})():{...(sectionData||{})};
        if(body.field_edits&&typeof body.field_edits==='object'){
          const typed={}, fragment={}; for(const [field,val] of Object.entries(body.field_edits)){if(String(field).startsWith('fragment.'))fragment[String(field).slice(9)]=String(val??'');else typed[String(field)]=String(val??'');}
          if(Object.keys(typed).length)parsed=applyEditorFieldValues(parsed,typed);
          const fragKey=String(parsed.r2_key||'').trim();
          if(Object.keys(fragment).length&&fragKey){
            const bucket=String(parsed.r2_bucket||page?.r2_bucket||CMS_DEFAULT_R2_BUCKET).trim(), binding=getCmsR2Binding(env,bucket), obj=binding?await binding.get(fragKey).catch(()=>null):null;
            if(obj){
              const html=await applyCmsFieldValuesToHtml(await obj.text(),fragment), hash=await cmsContentSha256(html), pageSlug=String(page?.slug||page?.route_path||row.page_id).replace(/^\//,'')||'page', newKey=cmsSectionHtmlKey(pageSlug,String(row.section_name||'section'),hash), encoded=new TextEncoder().encode(html);
              await binding.put(newKey,encoded,{httpMetadata:{contentType:'text/html; charset=utf-8'}});
              if(bucket!==CMS_DEFAULT_R2_BUCKET){const cmsBinding=getCmsR2Binding(env,CMS_DEFAULT_R2_BUCKET); if(cmsBinding)await cmsBinding.put(newKey,encoded,{httpMetadata:{contentType:'text/html; charset=utf-8'}}).catch(()=>null);}
              parsed={...parsed,r2_key:newKey,r2_bucket:bucket,public_url:(await presignR2GetObjectUrl(env,bucket,newKey))||cmsR2PublicUrlFromRequest(request,bucket,newKey),html_source:'injected',content_sha256:hash,updated_at:Math.floor(Date.now()/1000)};
            }
          }
        }
        parsed=normalizeSectionDataForWrite(parsed);
      }
      const updateInput={...body}; if(hasData)updateInput.section_data=parsed;
      const updated=await updateCmsSection(cmsScope,sectionMatch[1],updateInput,pageStore,sectionStore); if(!updated.ok)return jsonResponse({error:updated.error},updated.status||400);
      parsed=updated.section.data||{}; const projectSlug=String(updated.page?.project_slug||updated.page?.project_id||'').trim(), meta=cmsMutationMeta(authUser,request); if(body.agent_applied===true)meta.agentApplied=true;
      const draftPayload={sections:{[sectionMatch[1]]:parsed},page_id:row.page_id,updated_at:Math.floor(Date.now()/1000)};
      await stageCmsDraftKv(env,{pageId:row.page_id,userId:authUser.id,payload:draftPayload}); ctx.waitUntil(flushCmsDraftToD1(env,{pageId:row.page_id,userId:authUser.id,draftData:draftPayload}));
      if(updated.page){
        await host.syncDraftPageArtifact({
          workspaceId,
          page:updated.page,
          userId:authUser.id,
          draftData:draftPayload,
        });
      }
      ctx.waitUntil(logCmsActivity(env,{tenantId,userId:authUser.id,action:'section_update',resourceType:'section',resourceId:sectionMatch[1]}));
      auditCmsMutation(env,ctx,{workspaceId,tenantId,userId:authUser.id,projectSlug,pageId:row.page_id,sectionId:sectionMatch[1],agentApplied:meta.agentApplied,routeKey:meta.routeKey,changeSetId:body.change_set_id||null});
      if(meta.agentApplied||meta.routeKey==='cms_edit')ctx.waitUntil(logPromptCacheUsage(env,tenantId,[`cms_edit:${row.page_id}:${sectionMatch[1]}`],meta.routeKey||'cms_edit','cms_api','cms_edit',64).catch(()=>{}));
      if(projectSlug)invalidateCmsBootstrap(env,ctx,workspaceId,projectSlug);
      return jsonResponse({success:true,id:sectionMatch[1],section:{...sectionToLegacyRow(updated.section),section_data:parsed}});
    }catch(e){return jsonResponse({error:e.message},500)}
  }
  if(sectionMatch&&method==='DELETE'){
    try{const r=await removeCmsSection(cmsScope,sectionMatch[1],pageStore,sectionStore,blockStore); if(!r.ok)return jsonResponse({error:r.error},r.status||400); const slug=String(r.page?.project_slug||r.page?.project_id||'').trim(); ctx.waitUntil(logCmsActivity(env,{tenantId,userId:authUser.id,action:'section_delete',resourceType:'section',resourceId:sectionMatch[1]})); if(slug)invalidateCmsBootstrap(env,ctx,workspaceId,slug); return jsonResponse({success:true,id:sectionMatch[1],deleted:true});}catch(e){return jsonResponse({error:e.message},500)}
  }
  const blockMatch=path.match(/^\/api\/cms\/(?:components|blocks)\/([^/]+)$/);
  if(blockMatch&&method==='PUT'){
    let body={}; try{body=await request.json()}catch{return jsonResponse({error:'Invalid JSON body'},400)} const data=body.block_data??body.component_data??body.componentData??body.data; if(data==null)return jsonResponse({error:'component_data is required'},400);
    try{const r=await updateCmsBlock(cmsScope,blockMatch[1],{...body,data},pageStore,sectionStore,blockStore); if(!r.ok)return jsonResponse({error:r.error},r.status||400); const pageId=r.section.page_id,slug=String(r.page?.project_slug||r.page?.project_id||'').trim(),meta=cmsMutationMeta(authUser,request); if(body.agent_applied===true)meta.agentApplied=true; const payload={components:{[blockMatch[1]]:r.block.data},blocks:{[blockMatch[1]]:r.block.data},page_id:pageId,updated_at:Math.floor(Date.now()/1000)}; await stageCmsDraftKv(env,{pageId,userId:authUser.id,payload}); ctx.waitUntil(flushCmsDraftToD1(env,{pageId,userId:authUser.id,draftData:payload})); auditCmsMutation(env,ctx,{workspaceId,tenantId,userId:authUser.id,projectSlug:slug,pageId,sectionId:r.section.id,agentApplied:meta.agentApplied,routeKey:meta.routeKey,changeSetId:body.change_set_id||null}); ctx.waitUntil(logCmsActivity(env,{tenantId,userId:authUser.id,action:'block_update',resourceType:'block',resourceId:blockMatch[1]})); if(slug)invalidateCmsBootstrap(env,ctx,workspaceId,slug); return jsonResponse({success:true,id:blockMatch[1],block:r.block,component:blockToLegacyRow(r.block)});}catch(e){return jsonResponse({error:e.message},500)}
  }
  if(blockMatch&&method==='DELETE'){
    try{const r=await removeCmsBlock(cmsScope,blockMatch[1],pageStore,sectionStore,blockStore); if(!r.ok)return jsonResponse({error:r.error},r.status||400); const slug=String(r.page?.project_slug||r.page?.project_id||'').trim(); if(slug)invalidateCmsBootstrap(env,ctx,workspaceId,slug); ctx.waitUntil(logCmsActivity(env,{tenantId,userId:authUser.id,action:'block_delete',resourceType:'block',resourceId:blockMatch[1]})); return jsonResponse({success:true,id:blockMatch[1],deleted:true});}catch(e){return jsonResponse({error:e.message},500)}
  }
  if(path==='/api/cms/sections'&&method==='POST'){
    let body={}; try{body=await request.json()}catch{return jsonResponse({error:'invalid JSON'},400)}
    try{
      const { getCmsSection: getCmsSectionSchema, validateCmsContent } = await import('../../core/agentsam/cms/registry/index.js');
      const sectionType = String(body.section_type || body.sectionType || body.type || '').trim().toLowerCase();
      const sectionData = body.section_data ?? body.sectionData ?? body.data ?? {};
      if (sectionType && getCmsSectionSchema(sectionType)) {
        const checked = validateCmsContent('section', sectionType, sectionData);
        if (!checked.ok) {
          return jsonResponse({ error: 'cms_registry_validation_failed', issues: checked.issues || [], section_type: sectionType }, 422);
        }
        body = { ...body, section_type: sectionType, section_data: checked.data ?? sectionData };
      }
      const r=await createCmsSection(cmsScope,body,pageStore,sectionStore); if(!r.ok)return jsonResponse({error:r.error},r.status||400); return jsonResponse({success:true,id:r.section.id,section:sectionToLegacyRow(r.section)});
    }catch(e){return jsonResponse({error:e.message},500)}
  }
  if(path.match(/^\/api\/cms\/sections\/[^/]+\/visibility$/)&&method==='POST'){
    const id=path.split('/')[4]; let body={}; try{body=await request.json()}catch{} const visible=body.visible===true||body.is_visible===true||body.is_visible===1;
    try{const r=await setCmsSectionVisibility(cmsScope,id,visible,pageStore,sectionStore); if(!r.ok)return jsonResponse({error:r.error},r.status||400); return jsonResponse({success:true,id,visible:r.section.visible,is_visible:r.section.visible?1:0,section:sectionToLegacyRow(r.section)});}catch(e){return jsonResponse({error:e.message},500)}
  }
  if(path==='/api/cms/sections/reorder'&&method==='POST'){
    let body={}; try{body=await request.json()}catch{} try{const r=await reorderCmsSections(cmsScope,body.order,pageStore,sectionStore); if(!r.ok)return jsonResponse({error:r.error},r.status||400); return jsonResponse({success:true,updated:r.updated});}catch(e){return jsonResponse({error:e.message},500)}
  }
  if(path==='/api/cms/blocks'&&method==='GET'){
    const sectionId=String(url.searchParams.get('section_id')||'').trim(); if(!sectionId)return jsonResponse({error:'section_id is required'},400);
    try{const r=await listCmsBlocks(cmsScope,sectionId,pageStore,sectionStore,blockStore); if(!r.ok)return jsonResponse({error:r.error},r.status||400); return jsonResponse({section:sectionToLegacyRow(r.section),blocks:r.blocks,components:r.blocks.map(blockToLegacyRow)});}catch(e){return jsonResponse({error:e.message},500)}
  }
  if(path==='/api/cms/blocks'&&method==='POST'){
    let body={}; try{body=await request.json()}catch{return jsonResponse({error:'invalid JSON'},400)}
    try{const r=await createCmsBlock(cmsScope,body,pageStore,sectionStore,blockStore); if(!r.ok)return jsonResponse({error:r.error},r.status||400); const slug=String(r.page?.project_slug||r.page?.project_id||'').trim(); if(slug)invalidateCmsBootstrap(env,ctx,workspaceId,slug); ctx.waitUntil(logCmsActivity(env,{tenantId,userId:authUser.id,action:'block_create',resourceType:'block',resourceId:r.block.id})); return jsonResponse({success:true,id:r.block.id,block:r.block,component:blockToLegacyRow(r.block)});}catch(e){return jsonResponse({error:e.message},500)}
  }
  if(path.match(/^\/api\/cms\/blocks\/[^/]+\/visibility$/)&&method==='POST'){
    const id=path.split('/')[4]; let body={}; try{body=await request.json()}catch{} const visible=body.visible===true||body.is_visible===true||body.is_visible===1;
    try{const r=await setCmsBlockVisibility(cmsScope,id,visible,pageStore,sectionStore,blockStore); if(!r.ok)return jsonResponse({error:r.error},r.status||400); return jsonResponse({success:true,id,visible:r.block.visible,is_visible:r.block.visible?1:0,block:r.block});}catch(e){return jsonResponse({error:e.message},500)}
  }
  if(path==='/api/cms/blocks/reorder'&&method==='POST'){
    let body={}; try{body=await request.json()}catch{} try{const r=await reorderCmsBlocks(cmsScope,body.order,pageStore,sectionStore,blockStore); if(!r.ok)return jsonResponse({error:r.error},r.status||400); return jsonResponse({success:true,updated:r.updated});}catch(e){return jsonResponse({error:e.message},500)}
  }
  return null;
}
