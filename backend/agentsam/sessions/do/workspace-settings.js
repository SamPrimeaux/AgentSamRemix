export async function loadWorkspaceSettings(session) {
  const wid = String(session.workspaceId || '').trim();
  if (!session.env?.DB || !wid) {
    session.workspaceSettings = {};
    return session.workspaceSettings;
  }
  const row = await session.env.DB.prepare(
    'SELECT settings_json FROM workspace_settings WHERE workspace_id = ?',
  ).bind(wid).first();
  if (String(session.workspaceId || '').trim() !== wid) return session.workspaceSettings;
  try {
    const parsed = row?.settings_json ? JSON.parse(row.settings_json) : {};
    session.workspaceSettings = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    session.workspaceSettings = {};
  }
  return session.workspaceSettings;
}

export async function ensureWorkspaceSettingsLoaded(session, workspaceId) {
  const nextWorkspaceId = String(workspaceId || '').trim();
  if (session.workspaceId !== nextWorkspaceId) {
    session.workspaceId = nextWorkspaceId;
    session.workspaceSettings = {};
  }
  if (!nextWorkspaceId) {
    session.workspaceSettingsPromise = null;
    session.workspaceSettings = {};
    return session.workspaceSettings;
  }
  if (session.workspaceSettingsPromise) {
    await session.workspaceSettingsPromise;
    return session.workspaceSettings;
  }
  session.workspaceSettingsPromise = loadWorkspaceSettings(session).finally(() => {
    session.workspaceSettingsPromise = null;
  });
  await session.workspaceSettingsPromise;
  return session.workspaceSettings;
}
