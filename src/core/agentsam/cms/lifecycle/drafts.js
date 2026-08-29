function asObject(value) { return value && typeof value === 'object' ? value : null; }
export function normalizeCmsDraftPayload(value) {
  if (asObject(value)) return value;
  if (value == null) return {};
  return { content: value };
}
export async function stageCmsDraft(store, { pageId, userId, draftData }) {
  const payload = normalizeCmsDraftPayload(draftData);
  await store.putHotDraft(String(pageId), String(userId), payload);
  return { ok:true, draft_data:payload, hot:true };
}
export async function persistCmsDraft(store, { pageId, userId, draftData = null }) {
  let payload = asObject(draftData);
  if (!payload) payload = await store.getHotDraft(String(pageId), String(userId));
  if (!payload) return { ok:false, error:'no_draft' };
  await store.putDurableDraft(String(pageId), String(userId), payload);
  return { ok:true, draft_data:payload };
}
export async function clearCmsDraft(store, { pageId, userId, clearDurable = false }) {
  await store.deleteHotDraft(String(pageId), String(userId));
  if (clearDurable) await store.deleteDurableDraft(String(pageId), String(userId));
  return { ok:true };
}
