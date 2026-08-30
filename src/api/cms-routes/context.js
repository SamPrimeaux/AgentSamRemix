import { jsonResponse } from '../../core/auth.js';
import { resolveClientAppByProjectSlug } from '../../core/agentsam/cms/runtime/client-app.js';
import { provisionCmsProject } from '../../core/cms-project-provision.js';
import { resolveCmsSiteConfig } from '../../core/cms-site-config.js';

export async function handleCmsContextRoutes(state) {
  const { path, method, url, request, env, ctx, authUser, tenantId, personUuid, workspaceId, cmsScope } = state;
  if (path === '/api/cms/app-context' && method === 'GET') {
    const projectSlug=url.searchParams.get('project_slug')||url.searchParams.get('site')||url.searchParams.get('app_key')||null;
    if(!projectSlug)return jsonResponse({error:'project_slug required'},400);
    try{
      if(!cmsScope.allowedSlugs.has(String(projectSlug).trim()))return jsonResponse({error:'CMS_SITE_NOT_ALLOWED',project_slug:projectSlug},403);
      const app=await resolveClientAppByProjectSlug(env,projectSlug);if(!app)return jsonResponse({error:'CLIENT_APP_NOT_FOUND',message:`No active client_apps row for app_key=${projectSlug}`,project_slug:projectSlug},404);
      const cfg=await resolveCmsSiteConfig(env,workspaceId,projectSlug);
      return jsonResponse({...app,cms_api_profile:cfg.cms_api_profile||cfg.api_profile||app.cms_api_profile,api_profile:cfg.api_profile||app.cms_api_profile,website_r2:cfg.website_r2||app.website_r2,catalog_r2:cfg.catalog_r2||app.catalog_r2,r2_bucket:cfg.r2_bucket||app.website_r2?.bucket_name||null,d1_database_id:cfg.d1_database_id||null,inventory_source:cfg.inventory_source||'client_apps',agent_site_context:cfg.agent_site_context||null,workspace_id:workspaceId,project_slug:projectSlug});
    }catch(e){return jsonResponse({error:e.message||'app_context_failed'},500)}
  }
  if (path === '/api/cms/projects/create' && method === 'POST') {
    let body={};try{body=await request.json()}catch{return jsonResponse({error:'invalid JSON'},400)}
    const reqWorkspaceId=String(body.workspace_id||workspaceId||'').trim();if(reqWorkspaceId&&reqWorkspaceId!==workspaceId)return jsonResponse({error:'WORKSPACE_MISMATCH'},403);
    try{const result=await provisionCmsProject(env,ctx,{tenantId,workspaceId,userId:authUser.id,personUuid,authUser,request,payload:body});if(!result.ok)return jsonResponse({ok:false,error:result.error,project_slug:result.project_slug||null},result.status||400);return jsonResponse(result);}catch(e){return jsonResponse({ok:false,error:e.message},500)}
  }
  return null;
}
