/**
 * CMS page publish host adapter.
 * Canonical sequencing lives in agentsam/cms/pipeline/publish.js.
 */
import type { CmsPage, ExecuteCmsPagePublishOpts, ExecuteCmsPagePublishResult } from '../types/cms.ts';
import { cmsBootstrapKey } from './agentsam/cms/bootstrap/cache-key.js';
import { createCloudflareCmsLifecycleStore } from './agentsam/cms/adapters/cloudflare/lifecycle-store.js';
import { CMS_DEFAULT_R2_BUCKET, getCmsR2Binding } from './agentsam/cms/adapters/cloudflare/storage.js';
import { clearCmsDraft, createCmsPageRevision, promoteCmsDraftOverrides } from './agentsam/cms/lifecycle/index.js';
import { runCmsPublishPipeline } from './agentsam/cms/pipeline/index.js';
import { buildCmsPageUrls } from './agentsam/cms/preview/index.js';
import {
  auditCmsMutation,
  cmsPageHtmlKey as cmsPageKey,
  logCmsActivity,
} from './cms-edit-safety.js';
import { cmsPublishGateErrorResponse, runCmsPromotionGate, verifyCmsPublishContract } from './cms-promotion-gates.js';
import { cmsDraftPayloadBytes, cmsDraftSectionCount, cmsExceedsSpawnThreshold, maybeSpawnCmsHeavyJob } from './cms-spawn-bridge.js';
import { isFullHtmlDocument } from './cms-injected-sections.js';
import {
  assembleCmsHostPageArtifact,
  resolveCmsHostPageArtifact,
  usesCmsHostLegacyAssembler,
} from './cms-host-page-artifact.js';
import { emitInnerAnimalProEvent } from './inneranimalpro-stream.js';
import { ensureCmsDraftR2BeforePublish } from './cms-draft-artifact-host.js';
import { publishCmsPageSectionArtifacts } from './agentsam/cms/adapters/cloudflare/section-artifacts.js';

export async function executeCmsPagePublish(
  env: Record<string, unknown>,
  opts: ExecuteCmsPagePublishOpts,
): Promise<ExecuteCmsPagePublishResult> {
  const pageId=String(opts.pageId||'').trim();
  const page=(opts.page||{}) as CmsPage & Record<string,unknown>;
  const workspaceId=String(opts.workspaceId||'').trim();
  const tenantId=String(opts.tenantId||'').trim();
  const userId=String(opts.userId||'').trim();
  const agentApplied=opts.agentApplied===true;
  const ctx=opts.executionCtx||null;
  if(!(env as any)?.DB||!pageId||!workspaceId||!tenantId||!userId) return {ok:false,error:'missing_context'};

  const projectSlug=String(page.project_slug||page.project_id||'').trim();
  const waitUntil=(p:Promise<unknown>|undefined)=>{ if(ctx?.waitUntil&&p)ctx.waitUntil(p); else if(p)p.catch(()=>{}); };

  const lifecycleStore=createCloudflareCmsLifecycleStore(env);
  const metadata=await lifecycleStore.ensurePagePublishMetadata(pageId,page,projectSlug);
  if(metadata.seo_title) page.seo_title=metadata.seo_title;
  if(metadata.meta_description) page.meta_description=metadata.meta_description;

  const hostArtifact=resolveCmsHostPageArtifact(page,workspaceId,cmsPageKey);
  const layout=hostArtifact.layout;
  const r2Bucket=hostArtifact.bucket||CMS_DEFAULT_R2_BUCKET;
  const r2Binding=getCmsR2Binding(env,r2Bucket);
  const routePath=String(page.route_path||`/${page.slug||''}`).trim();
  const legacyAssemble=usesCmsHostLegacyAssembler(page);
  const storefrontHydrate=hostArtifact.hydrate;
  const publishContext:any={ pageId,page,workspaceId,tenantId,userId,projectSlug,agentApplied,ctx,layout,r2Bucket,r2Binding,routePath,legacyAssemble,storefrontHydrate };

  const result:any=await runCmsPublishPipeline(publishContext,{
    async ensureDraft(c:any){
      if(!c.r2Binding&&!c.legacyAssemble) return {ok:false,error:'R2 storage unavailable'};
      return ensureCmsDraftR2BeforePublish(env,{workspaceId:c.workspaceId,page:{...c.page,id:c.pageId},userId:c.userId,r2Binding:c.r2Binding,draftKey:c.layout.draft_key});
    },
    async verify(c:any){
      const record=await lifecycleStore.getDraftRecord(c.pageId,c.userId);
      const hasKvDraft=Boolean(record?.draftData);
      const contract=await verifyCmsPublishContract(env,{page:c.page,workspaceId:c.workspaceId,tenantId:c.tenantId,r2Binding:c.r2Binding,draftKey:c.layout.draft_key,hasKvDraft});
      const promotion=await runCmsPromotionGate(env,{page:c.page,tenantId:c.tenantId,projectSlug:c.projectSlug,r2Binding:c.r2Binding,draftKey:c.layout.draft_key,hasKvDraft});
      if(!contract.passed||!promotion.passed) return {passed:false,...cmsPublishGateErrorResponse({contract,promotion})};
      return {passed:true,contract,promotion};
    },
    acquireLock(c:any){ return lifecycleStore.acquirePublishLock(c.workspaceId,c.projectSlug,c.userId); },
    async releaseLock(c:any){ await lifecycleStore.releasePublishLock(c.workspaceId,c.projectSlug,c.userId); },
    async loadDraft(c:any){
      let draftObj=c.r2Binding?await c.r2Binding.get(c.layout.draft_key).catch(()=>null):null;
      if(!draftObj&&c.layout.mode==='storefront_asset'&&c.layout.legacy_draft_key&&c.r2Binding) draftObj=await c.r2Binding.get(c.layout.legacy_draft_key).catch(()=>null);
      const draftRecord=await lifecycleStore.getDraftRecord(c.pageId,c.userId);
      if(!draftObj&&draftRecord?.draftData?.r2_key&&c.r2Binding) draftObj=await c.r2Binding.get(String(draftRecord.draftData.r2_key)).catch(()=>null);
      let buffer:ArrayBuffer|null=null, html:string|null=null;
      if(draftObj){ buffer=await draftObj.arrayBuffer(); html=new TextDecoder().decode(buffer); }
      if(!draftObj&&!c.storefrontHydrate&&!c.legacyAssemble) throw new Error('No draft found to publish');
      return {data:draftRecord?.draftData||null,buffer,html};
    },
    async snapshotCurrent(c:any){
      if(String(c.page.status||'').toLowerCase()!=='published'||!String(c.page.r2_key||'').trim()) return null;
      return createCmsPageRevision(lifecycleStore,{page:{...c.page,id:c.pageId},workspaceId:c.workspaceId,createdAt:Math.floor(Date.now()/1000)});
    },
    async promoteStructuredDraft(c:any,draft:any){
      const data=draft?.data;
      if(!data||typeof data!=='object') return [];
      const sectionCount=cmsDraftSectionCount(data), payloadBytes=cmsDraftPayloadBytes(data);
      const spawnHint=cmsExceedsSpawnThreshold({sectionCount,payloadBytes});
      if(spawnHint.spawn) waitUntil(maybeSpawnCmsHeavyJob(env,c.ctx,{userId:c.userId,workspaceId:c.workspaceId,tenantId:c.tenantId,masterRunId:`cms_pub_${c.pageId}_${Date.now().toString(36)}`,taskDescription:`CMS publish promote ${sectionCount} sections (${payloadBytes} bytes)`,chunkCount:sectionCount}));
      const chain=await promoteCmsDraftOverrides(lifecycleStore,{page:{...c.page,id:c.pageId},draftData:data,userId:c.userId});
      waitUntil(logCmsActivity(env,{tenantId:c.tenantId,userId:c.userId,action:'draft_promote',resourceType:'page',resourceId:c.pageId,details:{overrides:chain.length,spawn_hint:spawnHint}}));
      return chain;
    },
    async promoteArtifact(c:any,draft:any){
      let assemble:any=null; let bytes=0;
      if(c.legacyAssemble){
        assemble=await assembleCmsHostPageArtifact(env,{page:{...c.page,id:c.pageId,route_path:c.routePath,slug:c.page.slug},r2Binding:c.r2Binding,draftOnly:false}) as any;
        if(!assemble?.ok) throw new Error(String(assemble?.error||'assemble_failed'));
        bytes=Number(assemble.bytes)||0;
      } else if(draft?.buffer&&draft?.html&&(!c.storefrontHydrate||isFullHtmlDocument(draft.html))){
        bytes=draft.buffer.byteLength;
        await c.r2Binding.put(c.layout.published_key,draft.buffer,{httpMetadata:{contentType:c.page.content_type||'text/html'}});
        if(c.layout.mode==='storefront_asset'&&c.layout.legacy_published_key) await c.r2Binding.put(c.layout.legacy_published_key,draft.buffer,{httpMetadata:{contentType:c.page.content_type||'text/html'}}).catch(()=>{});
      } else if(c.storefrontHydrate){
        const head=await c.r2Binding?.head(c.layout.published_key).catch(()=>null);
        bytes=Number(head?.size)||Number(c.page.content_size_bytes)||0;
      }
      return {r2_key:c.layout.published_key,r2_bucket:c.r2Bucket,byte_length:bytes,phase:c.legacyAssemble?'assembled_live':'published_live',assemble};
    },
    async commitPublished(c:any,state:any){
      const artifact=state.artifact||{}; const now=Math.floor(Date.now()/1000);
      await lifecycleStore.commitPublishedPage({pageId:c.pageId,userId:c.userId,now,r2Key:artifact.r2_key,byteLength:artifact.byte_length||0});
      return {status:'published',phase:artifact.phase,page_id:c.pageId,r2_key:artifact.r2_key,r2_bucket:String(artifact.r2_bucket),byte_length:artifact.byte_length||0,bootstrap_cache_key:cmsBootstrapKey(c.workspaceId,c.projectSlug),agent_applied:c.agentApplied,assemble:artifact.assemble||null,manifest_r2_key:artifact.sectionPublication?.manifest_r2_key||null,publication_id:artifact.sectionPublication?.publication_id||null};
    },
    async invalidate(c:any){
      if(c.projectSlug) await lifecycleStore.invalidateBootstrap(c.workspaceId,c.projectSlug);
      auditCmsMutation(env,c.ctx,{workspaceId:c.workspaceId,tenantId:c.tenantId,userId:c.userId,projectSlug:c.projectSlug,pageId:c.pageId,sectionId:'publish',agentApplied:c.agentApplied,routeKey:c.agentApplied?'cms_edit':undefined});
      waitUntil(logCmsActivity(env,{tenantId:c.tenantId,userId:c.userId,action:'publish',resourceType:'page',resourceId:c.pageId,details:c.agentApplied?{agent_applied:true}:undefined}));
      emitInnerAnimalProEvent(env,{userId:c.userId,eventName:`cms_publish:${c.pageId}:${c.projectSlug||c.page.slug||'page'}`},c.ctx);
    },
    async clearDraft(c:any){ await clearCmsDraft(lifecycleStore,{pageId:c.pageId,userId:c.userId,clearDurable:false}); },
  }).catch((error:any)=>({ok:false,error:String(error?.message||error)}));

  if(!result.ok) return result as ExecuteCmsPagePublishResult;
  const domain=await lifecycleStore.getTenantDomain(projectSlug);
  const previewUrls=buildCmsPageUrls({...page,id:pageId,status:'published',r2_key:result.r2_key},{domain,projectSlug});
  return {...result,preview_urls:previewUrls,live_url:previewUrls.live_url} as ExecuteCmsPagePublishResult;
}
