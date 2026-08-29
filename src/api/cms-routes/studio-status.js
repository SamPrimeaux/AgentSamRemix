import { jsonResponse } from '../../core/auth.js';
import { fetchCmsPageInScope } from '../../core/cms-access.js';
import { createCloudflareCmsStudioStatusStore } from '../../core/agentsam/cms/adapters/cloudflare/studio-status-store.js';
export async function handleCmsStudioStatusRoutes(state){
  const {path,method,url,env,cmsScope}=state;if(path!=='/api/cms/studio-status'||method!=='GET')return null;
  const pageId=String(url.searchParams.get('page_id')||'').trim(),projectSlug=String(url.searchParams.get('project_slug')||'').trim();
  try{const page=pageId?await fetchCmsPageInScope(env,pageId,cmsScope,projectSlug||null):null,store=createCloudflareCmsStudioStatusStore(env),patch=await store.latestPatch(pageId),live=await store.activeSession(pageId);
    return jsonResponse({page_id:pageId||null,project_slug:projectSlug||page?.project_slug||null,publish_status:page?.status||'unknown',published_at:page?.published_at||null,active_plan_id:patch?.plan_id||patch?.change_set_id||null,last_patch_session:patch?{task_file:patch.task_file,passed:patch.passed,applied:patch.applied,created_at:patch.created_at}:null,live_session:live?{session_id:live.id,user_id:live.user_id,is_active:!!live.is_active,last_activity:live.last_activity}:null});
  }catch(e){return jsonResponse({error:e.message},500)}
}
