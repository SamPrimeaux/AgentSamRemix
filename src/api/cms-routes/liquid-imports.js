import { jsonResponse } from '../../core/auth.js';
import { createCloudflareCmsLiquidImportStore } from '../../core/agentsam/cms/adapters/cloudflare/liquid-import-store.js';
import { CMS_DEFAULT_R2_BUCKET, getCmsR2Binding } from '../../core/agentsam/cms/adapters/cloudflare/storage.js';
import { resolveCmsBootstrapProjectSlug } from '../../core/cms-workspace-resolve.js';
import { maybeSpawnCmsHeavyJob } from '../../core/cms-spawn-bridge.js';
import { emitInnerAnimalProEvent } from '../../core/inneranimalpro-stream.js';

async function resolveProject(state, explicit) {
  return resolveCmsBootstrapProjectSlug(state.env,state.request,state.authUser,state.workspaceId,explicit,state.requestCache);
}
async function queueImport(state, created, importName, r2Key='', r2Bucket=CMS_DEFAULT_R2_BUCKET) {
  const spawn=await maybeSpawnCmsHeavyJob(state.env,state.ctx,{userId:state.authUser.id,workspaceId:state.workspaceId,tenantId:state.tenantId,masterRunId:`cms_limp_${created.id}`,taskDescription:`CMS liquid import ${importName}`,chunkCount:1});
  if(state.env.MY_QUEUE&&(r2Key)){state.ctx.waitUntil(state.env.MY_QUEUE.send({type:'cms_liquid_import',phase:'inventory',import_id:created.id,tenant_id:state.tenantId,workspace_id:state.workspaceId,r2_key:r2Key,r2_bucket:r2Bucket,import_name:importName}).catch(()=>{}));}
  return spawn;
}
export async function handleCmsLiquidImportRoutes(state){
  const {path,method,url,request,env,ctx,authUser,tenantId,workspaceId}=state;
  const store=createCloudflareCmsLiquidImportStore(env);
  if(path==='/api/cms/liquid-imports/upload'&&method==='POST'){
    const ct=String(request.headers.get('content-type')||'').toLowerCase(); if(!ct.includes('multipart/form-data'))return jsonResponse({error:'multipart/form-data required'},400);
    let form; try{form=await request.formData()}catch{return jsonResponse({error:'invalid multipart body'},400)}
    const file=form.get('file'); if(!(file instanceof File)||file.size<1)return jsonResponse({error:'file required (.zip or .tar.gz theme archive)'},400);
    const importName=String(form.get('import_name')||file.name||'Shopify theme import').trim();
    const resolved=await resolveProject(state,String(form.get('project_slug')||form.get('project_id')||'').trim()||url.searchParams.get('project_slug')||url.searchParams.get('site')||null);
    if(resolved.error)return jsonResponse({error:resolved.error,message:resolved.message,sites:resolved.context?.sites||[]},resolved.error==='CMS_PROJECT_UNRESOLVED'?404:400);
    const lower=String(file.name||'').toLowerCase(); if(!['.zip','.tar.gz','.tgz','.tar'].some((ext)=>lower.endsWith(ext)))return jsonResponse({error:'unsupported_file_type',allowed:['.zip','.tar.gz','.tgz','.tar']},400);
    if(file.size>80*1024*1024)return jsonResponse({error:'file_too_large',max_mb:80},413);
    try{
      const id=`limp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`,safeFile=String(file.name||'theme.zip').replace(/[^a-zA-Z0-9._-]+/g,'_'),r2Key=`cms/liquid-imports/uploads/${id}/${safeFile}`,bucket=CMS_DEFAULT_R2_BUCKET,binding=getCmsR2Binding(env,bucket); if(!binding)return jsonResponse({error:'R2 storage unavailable'},503);
      await binding.put(r2Key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type||'application/octet-stream'}});
      const created=await store.create({id,tenantId,workspaceId,projectSlug:resolved.project_slug,importName,sourceType:'upload',sourcePath:safeFile,r2Bucket:bucket,r2Key,metadata:{original_filename:file.name,size_bytes:file.size},userId:authUser.id});
      const spawn=await queueImport(state,created,`upload ${importName}`,r2Key,bucket);
      emitInnerAnimalProEvent(env,{userId:authUser.id,eventName:`liquid_import_queued:${created.id}:${importName}`},ctx);
      return jsonResponse({success:true,id:created.id,status:'pending',r2_key:r2Key,r2_bucket:bucket,spawn});
    }catch(e){return jsonResponse({error:e.message},500)}
  }
  if(path==='/api/cms/liquid-imports'&&method==='GET'){
    try{const id=url.searchParams.get('import_id')||url.searchParams.get('id'); if(id){const row=await store.get(tenantId,id); return row?jsonResponse({import:row}):jsonResponse({error:'import_not_found'},404)} return jsonResponse({imports:await store.list(tenantId,20)});}catch(e){return jsonResponse({error:e.message},500)}
  }
  if(path==='/api/cms/liquid-imports'&&method==='POST'){
    let body={};try{body=await request.json()}catch{}
    const {import_name,source_type,r2_key,r2_bucket,source_url,project_id}=body;if(!import_name||!source_type)return jsonResponse({error:'import_name and source_type required'},400);if(source_type!=='upload'&&!r2_key&&!source_url)return jsonResponse({error:'r2_key_or_source_url_required',hint:'Upload theme .zip via POST /api/cms/liquid-imports/upload (multipart file)'},400);
    const resolved=await resolveProject(state,project_id||url.searchParams.get('project_slug')||url.searchParams.get('site')||null);if(resolved.error)return jsonResponse({error:resolved.error,message:resolved.message,sites:resolved.context?.sites||[]},resolved.error==='CMS_PROJECT_UNRESOLVED'?404:400);
    try{const created=await store.create({tenantId,workspaceId,projectSlug:resolved.project_slug,importName:import_name,sourceType:source_type,sourcePath:r2_key||source_url||'',sourceUrl:source_url||'',r2Bucket:r2_bucket||CMS_DEFAULT_R2_BUCKET,r2Key:r2_key||'',userId:authUser.id});const spawn=await queueImport(state,created,`${import_name} (${source_type})`,r2_key||'',r2_bucket||CMS_DEFAULT_R2_BUCKET);return jsonResponse({success:true,id:created.id,status:'pending',spawn});}catch(e){return jsonResponse({error:e.message},500)}
  }
  return null;
}
