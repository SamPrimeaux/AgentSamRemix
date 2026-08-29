import { flattenWorkflowInput, getByPath, safeJsonObject, workflowHandlerContext } from './common.js';

async function d1All(env, sql, binds = []) {
  if (!env?.DB) return { ok: false, error: 'DB not available', rows: [] };
  try {
    const stmt = env.DB.prepare(sql);
    const { results } = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
    return { ok: true, rows: results || [] };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e), rows: [] };
  }
}

export async function auditWorkflowTables(env) {
  const queries = {
    workflows: `SELECT COUNT(*) AS c FROM agentsam_workflows WHERE COALESCE(is_active, 1) = 1`,
    nodes: `SELECT COUNT(*) AS c FROM agentsam_workflow_nodes WHERE COALESCE(is_active, 1) = 1`,
    edges: `SELECT COUNT(*) AS c FROM agentsam_workflow_edges`,
    runs: `SELECT COUNT(*) AS c FROM agentsam_workflow_runs`,
    runs_failed: `SELECT COUNT(*) AS c FROM agentsam_workflow_runs WHERE status = 'failed'`,
    orphan_nodes: `SELECT COUNT(*) AS c FROM agentsam_workflow_nodes n
      WHERE COALESCE(n.is_active,1)=1
        AND NOT EXISTS (SELECT 1 FROM agentsam_workflows w WHERE w.id=n.workflow_id)`,
  };
  const out = {};
  for (const [key, sql] of Object.entries(queries)) {
    const r = await d1All(env, sql);
    out[key] = r.ok ? (r.rows[0]?.c ?? r.rows[0]) : { error: r.error };
  }
  return out;
}

const EVAL_HANDLERS = {
  'eval.patch_plan_quality'(flat) {
    const text = JSON.stringify(flat);
    const hasPath = /\b(src\/|dashboard\/|\.tsx?|\.jsx?|\.js)\b/i.test(text);
    const hasTest = /\b(test|vitest|npm run)\b/i.test(text);
    const vague = /\b(maybe|consider|might|possibly)\b/i.test(text);
    return { passed: hasPath && !vague, has_file_paths: hasPath, has_tests_mentioned: hasTest, vague_language: vague };
  },
  async 'eval.workflow_graph_health'(_flat, _input, _ctx, env) {
    const audit = await auditWorkflowTables(env);
    return { passed: Number(audit.workflows?.c ?? audit.workflows ?? 0) > 0, audit };
  },
  'eval.artifact_payload'(flat) {
    const name = flat.name || flat.title;
    const r2 = flat.r2_key || flat.planned_r2_key;
    const size = Number(flat.size_bytes || flat.file_size_bytes || 0);
    return { passed: !!name && !!r2 && size >= 0, name, r2_key: r2, size_bytes: size };
  },
  'eval.chart_dataset_contract'(flat) {
    const ds = flat.datasets || flat.charts || flat;
    const hasSeries = Array.isArray(ds) ? ds.length > 0 : typeof ds === 'object' && ds != null && Object.keys(ds).length > 0;
    return { passed: hasSeries, dataset_keys: typeof ds === 'object' && ds ? Object.keys(ds) : [] };
  },
  'agentsam.qa.assertions'(flat) {
    const ok = flat.ok === true || flat.passed === true || (flat.capture != null && flat.screenshot != null) || (flat.output && typeof flat.output === 'object' && flat.output.ok !== false);
    return { passed: ok, ok, evidence_present: ok };
  },
  'eval_cms_live_editor_contract'(flat) {
    const manifest = flat.manifest || flat.dev_app_manifest || flat.output?.manifest;
    const r2 = flat.r2_key || flat.planned_r2_key || flat.output?.r2_key;
    const passed = !!(manifest || r2);
    return { passed, pass: passed ? 1 : 0, has_manifest: !!manifest, has_r2: !!r2 };
  },
};

export async function executeWorkflowEval(env, handlerKey, input, runContext, node, config = null) {
  const flat = flattenWorkflowInput(input);
  const hk = String(handlerKey || '').trim();
  if (hk && EVAL_HANDLERS[hk]) {
    const out = await EVAL_HANDLERS[hk](flat, input, workflowHandlerContext(runContext, node), env);
    return { ok: true, output: { ...out, handler_key: hk } };
  }
  const qg = config && typeof config === 'object' && Object.keys(config).length
    ? config
    : safeJsonObject(node?.quality_gate_json);
  const assertions = Array.isArray(qg.assertions) ? qg.assertions : [];
  const results = assertions.map((a) => {
    const val = getByPath(flat, a.field) ?? flat[a.field];
    let pass = true;
    if (a.op === 'exists') pass = val != null && val !== '';
    else if (a.op === 'eq') pass = val === a.value;
    else if (a.op === 'gt') pass = Number(val) > Number(a.value);
    else if (a.op === 'gte') pass = Number(val) >= Number(a.value);
    else if (a.op === 'contains') pass = String(val ?? '').includes(String(a.value ?? ''));
    return { field: a.field, op: a.op, pass, value: val };
  });
  const passed = results.length ? results.every((r) => r.pass) : true;
  return { ok: true, output: { passed, assertion_count: results.length, results, handler_key: hk || null } };
}
