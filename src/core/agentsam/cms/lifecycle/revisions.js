export function normalizeCmsRevision(row) {
  if (!row || typeof row !== 'object') return null;
  const source = row.source || (row.override_id ? 'override' : 'artifact');
  return {
    id: String(row.id || row.version_id || ''),
    source,
    page_id: row.page_id ? String(row.page_id) : null,
    override_id: row.override_id ? String(row.override_id) : null,
    version: Number(row.version || 0) || null,
    artifact_key: row.previous_r2_key || row.artifact_key || null,
    content_hash: row.deployed_html_hash || row.content_hash || null,
    status: String(row.status || 'published'),
    created_by: row.created_by || null,
    created_at: row.created_at ?? null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  };
}
export async function listCmsPageRevisions(store, pageId, options={}) {
  const rows = await store.listArtifactRevisions(String(pageId), Number(options.limit || 20));
  return { ok:true, revisions:(rows||[]).map(normalizeCmsRevision).filter(Boolean) };
}
export async function createCmsPageRevision(store, input) {
  const revision = await store.createArtifactRevision(input);
  return { ok:true, revision:normalizeCmsRevision(revision) };
}
export async function restoreCmsPageRevision(store, input) {
  const result = await store.restoreArtifactRevision(input);
  if (!result?.ok) return result || {ok:false,error:'revision_restore_failed'};
  return { ...result, revision: normalizeCmsRevision(result.revision) };
}
export async function publishCmsOverrideRevision(store, overrideId, actor={}) {
  const result = await store.publishOverrideRevision(String(overrideId), actor);
  return result?.ok ? { ...result, revision: normalizeCmsRevision(result.revision) } : result;
}

export function cmsOverrideProjectId(raw) {
  const s=String(raw||'0').trim(); const n=parseInt(s,10); if(!Number.isNaN(n)&&String(n)===s)return n;
  let h=0; for(let i=0;i<s.length;i++)h=((h<<5)-h+s.charCodeAt(i))|0; return Math.abs(h)||1;
}

export async function upsertCmsOverrideDraft(store, input) {
  const projectSlug=String(input?.projectSlug||input?.project_slug||input?.projectId||'').trim();
  const path=String(input?.path||'').trim();
  const section=String(input?.section||'hero').trim();
  if(!projectSlug||!path)return{ok:false,error:'project_slug_and_path_required'};
  const payload=typeof input?.overridesJson==='string'?input.overridesJson:JSON.stringify(input?.overridesJson||{});
  const result=await store.upsertOverrideDraft({
    projectId:cmsOverrideProjectId(input?.projectId||projectSlug),
    projectIdText:String(input?.projectId||projectSlug),
    projectSlug,path,section,payload,userId:input?.userId||null,
  });
  return{ok:true,id:result.id,project_slug:projectSlug};
}

export async function promoteCmsDraftOverrides(store, input) {
  const page=input?.page||{};
  const draftData=input?.draftData&&typeof input.draftData==='object'?input.draftData:{};
  const sections=draftData.sections&&typeof draftData.sections==='object'?draftData.sections:{};
  const projectSlug=String(page.project_slug||page.project_id||'').trim();
  const path=String(page.route_path||`/${page.slug||''}`).trim()||'/';
  const out=[];
  for(const [section,payload] of Object.entries(sections)) {
    const override=await store.upsertOverrideDraft({
      projectId:cmsOverrideProjectId(page.project_id||projectSlug),
      projectIdText:String(page.project_id||projectSlug),projectSlug,path,section,
      payload:typeof payload==='string'?payload:JSON.stringify(payload||{}),userId:input.userId||null,
    });
    const published=await publishCmsOverrideRevision(store,override.id,{userId:input.userId||null,useCurrentVersion:override.isNew===true});
    if(published?.ok) out.push({override_id:override.id,version_id:published.version_id,section});
  }
  return out;
}
