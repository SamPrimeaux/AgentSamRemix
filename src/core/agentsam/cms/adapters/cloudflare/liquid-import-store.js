export function createCloudflareCmsLiquidImportStore(env) {
  const db = env?.DB;
  if (!db?.prepare) throw new TypeError('D1 database binding required');
  return {
    async get(tenantId,id){return db.prepare(`SELECT id, import_key, import_name, source_type, status, project_id, sections_found, sections_mapped, pages_created, templates_found, error_log, result_json, created_at, completed_at FROM cms_liquid_imports WHERE tenant_id=? AND id=? LIMIT 1`).bind(tenantId,id).first().catch(()=>null)},
    async list(tenantId,limit=20){const {results=[]}=await db.prepare(`SELECT id, import_key, import_name, source_type, status, project_id, sections_found, sections_mapped, pages_created, templates_found, error_log, created_at, completed_at FROM cms_liquid_imports WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?`).bind(tenantId,Math.max(1,Math.min(100,Number(limit)||20))).all();return results},
    async create(input){
      const id=input.id||`limp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
      const key=input.importKey||String(input.importName||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,64);
      const now=input.now||Math.floor(Date.now()/1000);
      await db.prepare(`INSERT INTO cms_liquid_imports (id,tenant_id,workspace_id,project_id,import_key,import_name,source_type,source_path,source_url,r2_bucket,r2_key,status,sections_found,snippets_found,templates_found,sections_mapped,pages_created,assets_registered,metadata_json,result_json,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',0,0,0,0,0,0,?,'{}',?,?,?)`)
        .bind(id,input.tenantId,input.workspaceId,input.projectSlug,key,input.importName,input.sourceType,input.sourcePath||'',input.sourceUrl||'',input.r2Bucket||'cms',input.r2Key||'',typeof input.metadata==='string'?input.metadata:JSON.stringify(input.metadata||{}),input.userId||null,now,now).run();
      return {id,importKey:key,status:'pending'};
    },
  };
}
