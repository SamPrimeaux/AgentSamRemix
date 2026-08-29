import { migrateSessionAgentContextSchema } from './schema.js';

export async function setSessionContext(session, tools, writePolicy, roots) {
  migrateSessionAgentContextSchema(session.sql);
  const mode = roots && typeof roots === 'object' && roots.mode != null
    ? String(roots.mode)
    : writePolicy && typeof writePolicy === 'object' && writePolicy.mode != null
      ? String(writePolicy.mode)
      : null;
  const toolsJson = JSON.stringify(Array.isArray(tools) ? tools : []);
  const wpJson = JSON.stringify(writePolicy && typeof writePolicy === 'object' ? writePolicy : {});
  const rootsObj = roots && typeof roots === 'object' ? { ...roots } : {};
  if (mode) rootsObj.mode = mode;
  const rootsJson = JSON.stringify(rootsObj);
  session.sql.exec(
    `INSERT INTO session_agent_context (id, mode, tools_json, write_policy_json, roots_json, updated_at)
     VALUES (1, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(id) DO UPDATE SET
       mode = excluded.mode,
       tools_json = excluded.tools_json,
       write_policy_json = excluded.write_policy_json,
       roots_json = excluded.roots_json,
       updated_at = unixepoch()`,
    mode, toolsJson, wpJson, rootsJson,
  );
  return { ok: true, tools: Array.isArray(tools) ? tools.length : 0 };
}

export async function getSessionContext(session) {
  migrateSessionAgentContextSchema(session.sql);
  const rows = [...session.sql.exec(
    `SELECT mode, tools_json, write_policy_json, roots_json, updated_at
     FROM session_agent_context WHERE id = 1 LIMIT 1`,
  )];
  if (!rows.length) return null;
  const row = rows[0];
  let tools = [];
  let writePolicy = {};
  let roots = {};
  try { tools = JSON.parse(String(row.tools_json || '[]')); } catch { tools = []; }
  try { writePolicy = JSON.parse(String(row.write_policy_json || '{}')); } catch { writePolicy = {}; }
  try { roots = JSON.parse(String(row.roots_json || '{}')); } catch { roots = {}; }
  if (!Array.isArray(tools) || !tools.length) return null;
  return {
    mode: row.mode != null ? String(row.mode) : roots.mode || null,
    tools,
    writePolicy,
    roots,
    updated_at: row.updated_at,
  };
}
