import { getWorkflowById } from './workflows.js';

export function resolveDagWorkflowId(_db, workflow) {
  return workflow?.id ? String(workflow.id) : null;
}

export async function loadWorkflowGraph(db, workflowId, _tenantId = null, _workspaceId = null) {
  const workflow = await getWorkflowById(db, workflowId);
  if (!workflow) return null;
  const dagWorkflowId = resolveDagWorkflowId(db, workflow);
  const [nodesResult, edgesResult] = await Promise.all([
    db.prepare(
      `SELECT * FROM agentsam_workflow_nodes
       WHERE workflow_id = ? AND COALESCE(is_active, 1) = 1
       ORDER BY sort_order ASC, node_key ASC`,
    ).bind(dagWorkflowId).all(),
    db.prepare(
      `SELECT * FROM agentsam_workflow_edges
       WHERE workflow_id = ?
       ORDER BY priority ASC, from_node_key ASC`,
    ).bind(dagWorkflowId).all(),
  ]);
  return {
    workflow,
    workflow_id: dagWorkflowId,
    nodes: nodesResult?.results || [],
    edges: edgesResult?.results || [],
  };
}
