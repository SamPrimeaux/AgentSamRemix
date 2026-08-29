export function createCloudflareCmsIntegrationStore(env) {
  const db=env?.DB;if(!db?.prepare)throw new TypeError('D1 database binding required');
  return {
    async connected(authTenantId,clientId){const {results=[]}=await db.prepare(`SELECT ci.id,ci.client_id,ci.integration_id,ci.is_active,ci.config,ci.last_sync_at,ci.created_at,COALESCE(ir.display_name,ci.integration_id) AS display_name,ir.provider_key,ir.custom_icon_url AS icon_url,ir.category FROM client_integrations ci LEFT JOIN integration_registry ir ON ir.provider_key=ci.integration_id AND (ir.tenant_id=? OR ir.tenant_id IS NULL OR ir.tenant_id='') WHERE ci.client_id=? AND COALESCE(ci.is_active,1)=1 ORDER BY display_name`).bind(authTenantId,clientId).all().catch(()=>({results:[]}));return results},
    async recommended(authTenantId,platformTenantId){const {results=[]}=await db.prepare(`SELECT provider_key,display_name,custom_icon_url AS icon_url,category,status FROM integration_registry WHERE COALESCE(is_enabled,1)=1 AND (tenant_id=? OR tenant_id IS NULL OR tenant_id='' OR tenant_id=?) ORDER BY COALESCE(sort_order,999),display_name LIMIT 40`).bind(authTenantId,platformTenantId).all().catch(()=>({results:[]}));return results},
  };
}
