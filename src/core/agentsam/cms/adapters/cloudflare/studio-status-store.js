export function createCloudflareCmsStudioStatusStore(env){
  const db=env?.DB;if(!db?.prepare)throw new TypeError('D1 database binding required');
  return {
    async latestPatch(pageId=''){return db.prepare(`SELECT plan_id,change_set_id,task_file,passed,applied,created_at FROM agentsam_patch_sessions WHERE task_file LIKE ? ORDER BY created_at DESC LIMIT 1`).bind(pageId?`cms/%/${pageId}/%`:'cms/%').first().catch(()=>null)},
    async activeSession(pageId){if(!pageId)return null;return db.prepare(`SELECT id,page_id,user_id,is_active,last_activity,created_at FROM cms_live_edit_sessions WHERE page_id=? AND is_active=1 ORDER BY last_activity DESC LIMIT 1`).bind(pageId).first().catch(()=>null)},
  };
}
