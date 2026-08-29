export function assertCmsLifecycleStore(store) {
  for (const m of ['putHotDraft','getHotDraft','deleteHotDraft','putDurableDraft','deleteDurableDraft','listArtifactRevisions','createArtifactRevision','restoreArtifactRevision','publishOverrideRevision','upsertOverrideDraft']) {
    if (typeof store?.[m] !== 'function') throw new TypeError(`CMS lifecycle store missing ${m}()`);
  }
  return store;
}
