/**
 * Workflow Studio — /dashboard/workflows
 */
import React, { useCallback, useEffect, useState } from 'react';
import './workflows.css';
import type { DrawerMode, InspectorTab, WorkflowGraph, WorkflowListItem } from './workflowTypes';
import {
  fetchWorkflowGraph,
  fetchWorkflowList,
  saveCanvasLayout,
  createNode,
  createWorkflow,
} from './lib/workflowApi';
import { autoLayoutNodes } from './lib/workflowLayout';
import { WorkflowCanvas, type NodeStatus } from './components/WorkflowCanvas';
import { WorkflowRail } from './components/WorkflowRail';
import { WorkflowDrawer } from './components/WorkflowDrawer';
import { WorkflowInspector } from './components/WorkflowInspector';
import { WorkflowStudioBanner } from './components/WorkflowStudioBanner';
import { WorkflowDagLegend } from './components/WorkflowDagLegend';
import { WorkflowMobileLane } from './components/WorkflowMobileLane';
import '../../components/ui/AppIcon.css';
import {
  useWorkflowRunner,
  type WorkflowRow,
} from '../../components/ChatAssistant/components/WorkflowRunBoard';

type WfEdgeLite = { id: string; from: string; to: string };

function useMobileWorkflowLane(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const fn = () => setMobile(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return mobile;
}

function applyWorkflowSseToCanvas(
  d: Record<string, unknown>,
  edges: WfEdgeLite[],
  setNodeStatuses: React.Dispatch<React.SetStateAction<Record<string, NodeStatus>>>,
  setActiveEdges: React.Dispatch<React.SetStateAction<Set<string>>>,
) {
  const t = String(d.type ?? '');
  if (t === 'workflow_start') {
    setNodeStatuses({});
    setActiveEdges(new Set());
    return;
  }
  if (t === 'workflow_step') {
    const nodeKey = String(d.current_node_key ?? d.node_key ?? '');
    const ok = d.ok !== false;
    if (!nodeKey) return;
    setNodeStatuses((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (next[k] === 'running') next[k] = 'completed';
      });
      next[nodeKey] = ok ? 'running' : 'failed';
      return next;
    });
    const inc = edges.filter((e) => e.to === nodeKey).map((e) => e.id);
    if (inc.length) {
      setActiveEdges((prev) => {
        const s = new Set(prev);
        inc.forEach((id) => s.add(id));
        return s;
      });
    }
    if (ok) {
      setTimeout(() => {
        setNodeStatuses((prev) => ({ ...prev, [nodeKey]: 'completed' }));
      }, 400);
    }
  }
  if (t === 'workflow_error') {
    const nodeKey = String(d.current_node_key ?? d.node_key ?? '');
    if (nodeKey) setNodeStatuses((prev) => ({ ...prev, [nodeKey]: 'failed' }));
  }
}

export const WorkflowsPage: React.FC = () => {
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedRegistryId, setSelectedRegistryId] = useState<string | null>(null);
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphVersion, setGraphVersion] = useState(0);

  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('config');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [connectMode, setConnectMode] = useState(false);
  const [traceMode, setTraceMode] = useState(false);

  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);

  const [graphEdges, setGraphEdges] = useState<WfEdgeLite[]>([]);
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, NodeStatus>>({});
  const [activeEdges, setActiveEdges] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const mobileLane = useMobileWorkflowLane();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const list = await fetchWorkflowList();
      setWorkflows(list);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setListLoading(false);
    }
  }, [selectedRegistryId]);

  const loadGraph = useCallback(async (registryId: string) => {
    setGraphLoading(true);
    try {
      const g = await fetchWorkflowGraph(registryId);
      setGraph(g);
      setGraphEdges(g.edges.map((e) => ({ id: e.id, from: e.from, to: e.to })));
    } catch (e) {
      setGraph(null);
      setGraphEdges([]);
      showToast(e instanceof Error ? e.message : 'Failed to load graph');
    } finally {
      setGraphLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadList();
  }, []);

  useEffect(() => {
    if (!listLoading && workflows.length > 0 && !selectedRegistryId && drawerMode === null) {
      const hint = sessionStorage.getItem('wf-studio-library-hint');
      if (!hint) {
        setDrawerMode('library');
        sessionStorage.setItem('wf-studio-library-hint', '1');
      }
    }
  }, [listLoading, workflows.length, selectedRegistryId, drawerMode]);

  useEffect(() => {
    if (selectedRegistryId) void loadGraph(selectedRegistryId);
  }, [selectedRegistryId, graphVersion, loadGraph]);

  const bumpGraph = useCallback(() => {
    setGraphVersion((v) => v + 1);
    void loadList();
  }, [loadList]);

  const { runState, approvalBusy, startWorkflow, handleApproval } = useWorkflowRunner({
    onSseChunk: (d) => {
      applyWorkflowSseToCanvas(d, graphEdges, setNodeStatuses, setActiveEdges);
      const t = String(d.type ?? '');
      if (t === 'workflow_complete') showToast('Workflow completed');
      if (t === 'workflow_error') showToast(String(d.message ?? 'Workflow error'));
      if (t === 'workflow_approval_required') {
        showToast('Approval required — see Run tab');
        setInspectorTab('run');
      }
    },
  });

  const selectedWorkflowRow: WorkflowRow | null =
    workflows.find((w) => w.id === selectedRegistryId) ?? null;

  const isRunning = runState.status === 'running' || runState.status === 'awaiting_approval';

  const handleStart = useCallback(() => {
    if (!selectedWorkflowRow) {
      showToast('Select a workflow from the library first');
      return;
    }
    setNodeStatuses({});
    setActiveEdges(new Set());
    setInspectorTab('run');
    void startWorkflow(selectedWorkflowRow);
  }, [selectedWorkflowRow, startWorkflow, showToast]);

  const handleSavePositions = useCallback(
    async (positions: Record<string, { x: number; y: number }>) => {
      if (!selectedRegistryId) return;
      const out = await saveCanvasLayout(selectedRegistryId, positions);
      if (out.updated === 0 && !out.ok) {
        showToast('Layout save did not update any nodes');
      }
    },
    [selectedRegistryId, showToast],
  );

  const handleValidate = useCallback(() => {
    if (!graph) {
      showToast('No workflow loaded');
      return;
    }
    if (!graph.nodes.length) {
      showToast('Validation failed: no nodes');
      return;
    }
    const orphan = graph.nodes.filter(
      (n) => !graph.edges.some((e) => e.to === n.node_key || e.from === n.node_key),
    );
    if (graph.edges.length && orphan.length === graph.nodes.length) {
      showToast('Warning: nodes are not connected by edges');
      return;
    }
    showToast(`Valid: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
  }, [graph, showToast]);

  const handleAutoLayout = useCallback(async () => {
    if (!graph || !selectedRegistryId) return;
    const pos = autoLayoutNodes(graph.nodes, graph.edges);
    await saveCanvasLayout(selectedRegistryId, pos);
    bumpGraph();
    showToast('Auto layout saved');
  }, [graph, selectedRegistryId, bumpGraph, showToast]);

  const handleAddBlock = useCallback(
    async (nodeType: string) => {
      if (!selectedRegistryId) {
        showToast('Select a workflow first');
        return;
      }
      const key = `step_${Date.now().toString(36).slice(-6)}`;
      try {
        await createNode(selectedRegistryId, {
          node_key: key,
          title: key.replace(/_/g, ' '),
          node_type: nodeType,
        });
        bumpGraph();
        showToast(`Added ${nodeType} stage`);
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Add node failed');
      }
    },
    [selectedRegistryId, bumpGraph, showToast],
  );

  const handleCreateWorkflow = useCallback(async () => {
    const name = window.prompt('Workflow name', 'My automation');
    if (!name?.trim()) return;
    try {
      const created = await createWorkflow({ display_name: name.trim() });
      await loadList();
      setSelectedRegistryId(created.id);
      setDrawerMode('library');
      showToast(`Created ${created.workflow_key}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Create failed');
    }
  }, [loadList, showToast]);

  return (
    <div className={`wf-studio${inspectorOpen ? '' : ''}`}>
      <WorkflowStudioBanner
        workflowName={graph?.displayName ?? null}
        workflowKey={graph?.workflowKey ?? null}
        nodeCount={graph?.nodes.length ?? 0}
        edgeCount={graph?.edges.length ?? 0}
        runStatus={runState.status}
        isRunning={isRunning}
        onOpenLibrary={() => setDrawerMode('library')}
        onCreateWorkflow={() => void handleCreateWorkflow()}
        onRun={handleStart}
        canRun={!!selectedWorkflowRow}
      />

      <div className={`wf-main${inspectorOpen ? ' inspector-open' : ' inspector-collapsed'}`}>
        <div className={`wf-workspace${mobileLane && graph ? ' wf-workspace--mobile-lane' : ''}`}>
          <WorkflowRail
            drawerMode={drawerMode}
            connectMode={connectMode}
            traceMode={traceMode}
            inspectorOpen={inspectorOpen}
            onOpenDrawer={setDrawerMode}
            onToggleConnect={() => {
              setConnectMode((v) => !v);
              showToast(connectMode ? 'Connect mode off' : 'Connect mode: pick source node, then target in inspector');
            }}
            onToggleTrace={() => {
              setTraceMode((v) => !v);
              showToast(traceMode ? 'Trace preview off' : 'Trace preview on canvas');
            }}
            onValidate={handleValidate}
            onToggleInspector={() => setInspectorOpen((v) => !v)}
          />

          <WorkflowDrawer
            mode={drawerMode}
            onClose={() => setDrawerMode(null)}
            onToast={showToast}
            workflows={workflows}
            listLoading={listLoading}
            listError={listError}
            selectedRegistryId={selectedRegistryId}
            onSelectWorkflow={(id) => {
              setSelectedRegistryId(id);
              setSelectedNodeKey(null);
              setConnectFrom(null);
            }}
            onRefreshList={() => void loadList()}
            onAddBlock={(t) => void handleAddBlock(t)}
            onAutoLayout={() => void handleAutoLayout()}
            onRun={handleStart}
            canRun={!!selectedWorkflowRow}
            isRunning={isRunning}
            onCreateWorkflow={() => void handleCreateWorkflow()}
          />

          {mobileLane && graph && !graphLoading ? (
            <WorkflowMobileLane
              graph={graph}
              selectedNodeKey={selectedNodeKey}
              nodeStatuses={nodeStatuses}
              onSelectNode={(key) => {
                setSelectedNodeKey(key);
                if (key) {
                  setInspectorTab('config');
                  setInspectorOpen(true);
                }
              }}
              onOpenInspector={() => {
                setInspectorTab('config');
                setInspectorOpen(true);
              }}
            />
          ) : (
            <WorkflowCanvas
              graph={graph}
              graphLoading={graphLoading}
              selectedNodeKey={selectedNodeKey}
              onSelectNode={(key) => {
                setSelectedNodeKey(key);
                if (connectMode && key) {
                  if (!connectFrom) setConnectFrom(key);
                  else if (connectFrom !== key) {
                    setInspectorTab('config');
                    showToast(`Link ${connectFrom} → ${key} in Config tab`);
                  }
                }
              }}
              connectFrom={connectFrom}
              onSavePositions={handleSavePositions}
              externalStatuses={nodeStatuses}
              externalActiveEdges={activeEdges}
              liveRunning={isRunning}
              traceMode={traceMode}
              onOpenLibrary={() => setDrawerMode('library')}
            />
          )}

          {!mobileLane ? <WorkflowDagLegend /> : null}

          <div className={`wf-toast${toast ? ' show' : ''}`} role="status">
            {toast}
          </div>
        </div>

        {inspectorOpen ? (
          <WorkflowInspector
            tab={inspectorTab}
            onTab={setInspectorTab}
            graph={graph}
            selectedNodeKey={selectedNodeKey}
            connectFrom={connectFrom}
            onGraphChanged={bumpGraph}
            onConnectFrom={setConnectFrom}
            runState={runState}
            onApprove={handleApproval}
            approvalBusy={approvalBusy}
            onStartRun={handleStart}
            canRun={!!selectedWorkflowRow}
            isRunning={isRunning}
          />
        ) : null}
      </div>
    </div>
  );
};
