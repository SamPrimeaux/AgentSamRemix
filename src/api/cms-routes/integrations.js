import { jsonResponse } from '../../core/responses.js';
import { resolveCronTenantId } from '../../../backend/jobs/cron-tenant.js';
import { resolveClientAppByProjectSlug } from '../../core/agentsam/cms/runtime/client-app.js';
import { createCloudflareCmsIntegrationStore } from '../../core/agentsam/cms/adapters/cloudflare/integration-store.js';
export async function handleCmsIntegrationRoutes(state){
  const {path,method,url,env,authTenantId}=state;if(path!=='/api/cms/client-integrations'||method!=='GET')return null;
  const projectSlug=url.searchParams.get('project_slug')||url.searchParams.get('site')||null;if(!projectSlug)return jsonResponse({error:'project_slug required'},400);
  try{const app=await resolveClientAppByProjectSlug(env,projectSlug);if(!app?.client_id)return jsonResponse({connected:[],recommended:[],error:app?null:'CLIENT_APP_NOT_FOUND',client_id:null,project_slug:projectSlug},app?200:404);
    const store=createCloudflareCmsIntegrationStore(env),connected=await store.connected(authTenantId,app.client_id);let platformTenantId=authTenantId;const cronTenant=await resolveCronTenantId(env);if(cronTenant)platformTenantId=cronTenant;
    const recommended=await store.recommended(authTenantId,platformTenantId),keys=new Set(connected.map((r)=>String(r.integration_id||r.provider_key||'').trim()).filter(Boolean));
    return jsonResponse({project_slug:projectSlug,client_id:app.client_id,app_key:app.app_key,connected:connected.map((r)=>({id:r.id,integration_id:r.integration_id,provider_key:r.provider_key||r.integration_id,display_name:r.display_name||r.integration_id,icon_url:r.icon_url||null,category:r.category||null,is_active:!!r.is_active,last_sync_at:r.last_sync_at||null,config:(()=>{try{return r.config?JSON.parse(r.config):null}catch{return null}})()})),recommended:recommended.filter((r)=>{const k=String(r.provider_key||'').trim();return k&&!keys.has(k)}).map((r)=>({provider_key:r.provider_key,display_name:r.display_name||r.provider_key,icon_url:r.icon_url||null,category:r.category||null}))});
  }catch(e){return jsonResponse({error:e.message||'client_integrations_failed'},500)}
}
