export async function runCmsPublishPipeline(context, steps) {
  const required = ['ensureDraft','verify','acquireLock','loadDraft','promoteStructuredDraft','promoteArtifact','commitPublished','invalidate','clearDraft'];
  for (const name of required) if (typeof steps?.[name] !== 'function') throw new TypeError(`CMS publish pipeline missing ${name}()`);
  const trace=[];
  const push=(phase,details={})=>trace.push({phase,...details});
  push('start');
  const ensured = await steps.ensureDraft(context); push('draft_ready',{ok:ensured?.ok!==false});
  if (ensured?.ok===false) return {ok:false,error:ensured.error||'draft_prepare_failed',trace};
  const verified = await steps.verify(context); push('verified',{passed:verified?.passed!==false});
  if (verified?.passed===false) return {ok:false,error:verified.error||'publish_gate_blocked',...verified,trace};
  const lock = await steps.acquireLock(context); push('locked',{acquired:lock?.acquired!==false});
  if (lock?.acquired===false) return {ok:false,error:'publish_in_progress',holder:lock.holder||null,trace};
  try {
    const draft = await steps.loadDraft(context); push('draft_loaded',{has_draft:Boolean(draft)});
    const revision = typeof steps.snapshotCurrent === 'function' ? await steps.snapshotCurrent(context,draft) : null;
    push('revision_snapshotted',{revision_id:revision?.id||revision?.revision?.id||null});
    const structured = await steps.promoteStructuredDraft(context,draft); push('structured_promoted',{count:Array.isArray(structured)?structured.length:0});
    const artifact = await steps.promoteArtifact(context,draft); push('artifact_promoted',{key:artifact?.r2_key||null});
    const committed = await steps.commitPublished(context,{draft,structured,artifact}); push('committed');
    await steps.invalidate(context,committed); push('invalidated');
    await steps.clearDraft(context,committed); push('draft_cleared');
    return {ok:true,...committed,override_chain:structured||[],revision:revision?.revision||revision||null,trace};
  } finally {
    if (typeof steps.releaseLock === 'function') await steps.releaseLock(context).catch(()=>{});
  }
}
