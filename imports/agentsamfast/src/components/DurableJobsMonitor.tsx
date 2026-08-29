import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, Play, Pause, RotateCw, StopCircle, CheckCircle2,
  AlertTriangle, Clock, Search, Filter, ArrowUpRight,
  Database, GitBranch, ShieldAlert, Cpu, Check, Copy,
  RefreshCw, ChevronDown, ChevronRight, X, ExternalLink,
  Layers, Terminal, Send, Zap, SlidersHorizontal, Info
} from 'lucide-react';

export interface WorkflowRunRecord {
  id: string;
  workflow_id?: string;
  runtime: string;
  external_workflow_name: string;
  external_instance_id: string;
  external_version_id?: string;
  trigger_source: string;
  status: 'queued' | 'running' | 'paused' | 'waiting_for_event' | 'completed' | 'failed' | 'terminated' | 'rolled_back';
  workspace_id?: string;
  tenant_id?: string;
  agent_run_id?: string;
  policy_decision_id?: string;
  repo_snapshot_id?: string;
  current_step_index: number;
  total_steps: number;
  waiting_event_name?: string;
  params_json: string;
  output_json?: string;
  error_json?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface WorkflowDefinition {
  workflowName: string;
  title: string;
  description: string;
  category: string;
  stepCount: number;
  stepNames: Array<{ name: string; label: string }>;
  schedules?: Array<{ cron: string; name: string }>;
  stepLimit: number;
  defaultRetention?: { successRetentionDays: number; errorRetentionDays: number };
}

export interface WorkflowStepLog {
  id: string;
  instance_id: string;
  step_name: string;
  step_index: number;
  attempt: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'rolled_back' | 'skipped';
  input_json?: string;
  output_json?: string;
  error_json?: string;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
}

export interface WorkflowInstanceDetails {
  instanceId: string;
  workflowName: string;
  status: string;
  currentStepIndex: number;
  totalSteps: number;
  params: any;
  output?: any;
  error?: any;
  waitingEventName?: string;
  steps: WorkflowStepLog[];
  events?: any[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface DurableJobsStats {
  totalRuns: number;
  running: number;
  completed: number;
  failed: number;
  paused: number;
  waiting_for_event: number;
  rolled_back: number;
  statusCounts: Record<string, number>;
  workflowCounts: Record<string, number>;
}

export function DurableJobsMonitor() {
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([]);
  const [stats, setStats] = useState<DurableJobsStats | null>(null);
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(3000); // 3 seconds default
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  // Filters & Search
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [workflowFilter, setWorkflowFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected Run for Inspector Modal
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [inspectDetails, setInspectDetails] = useState<WorkflowInstanceDetails | null>(null);
  const [loadingInspect, setLoadingInspect] = useState<boolean>(false);

  // Trigger Modal State
  const [isTriggerModalOpen, setIsTriggerModalOpen] = useState<boolean>(false);
  const [selectedTriggerWorkflow, setSelectedTriggerWorkflow] = useState<string>('embedding-route-migration');
  const [triggerParams, setTriggerParams] = useState<Record<string, any>>({
    ticker: 'NVDA',
    sourceRouteKey: 'docs:reembedded:v1',
    targetRouteKey: 'docs:workers-ai-bge:v1',
    targetEmbeddingSpaceKey: 'workers-ai:bge-base-en-v1.5:768:mean:v1',
    targetDimensions: 768,
    provider: 'workers-ai',
    model: '@cf/baai/bge-base-en-v1.5',
    repoName: 'AgentSamFast/core',
    workspaceId: 'ws_prod_01',
    workspaceName: 'Production Analytics Alpha',
  });
  const [triggering, setTriggering] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Event dispatch state for approval gates
  const [eventInput, setEventInput] = useState<string>('human_approved');
  const [eventPayload, setEventPayload] = useState<string>('{"approver": "lead_analyst", "granted": true}');
  const [dispatchingEvent, setDispatchingEvent] = useState<boolean>(false);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Fetch workflow runs and statistics
  const fetchRunsAndStats = useCallback(async (showRefreshingState = false) => {
    if (showRefreshingState) setRefreshing(true);
    try {
      const queryParams = new URLSearchParams();
      queryParams.set('limit', '100');
      if (statusFilter !== 'all') queryParams.set('status', statusFilter);
      if (workflowFilter !== 'all') queryParams.set('workflow', workflowFilter);
      if (searchQuery.trim()) queryParams.set('search', searchQuery.trim());

      const [runsRes, statsRes, defsRes] = await Promise.all([
        fetch(`/api/workflows/runs?${queryParams.toString()}`),
        fetch('/api/workflows/stats'),
        fetch('/api/workflows/definitions'),
      ]);

      if (runsRes.ok) {
        const runsData = await runsRes.json();
        setRuns(runsData.runs || []);
      }
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
      if (defsRes.ok) {
        const defsData = await defsRes.json();
        setDefinitions(defsData.definitions || []);
      }

      setLastRefreshedAt(new Date());
    } catch (err) {
      console.error('[JobsMonitor] Error fetching runs:', err);
    } finally {
      setLoading(false);
      if (showRefreshingState) setRefreshing(false);
    }
  }, [statusFilter, workflowFilter, searchQuery]);

  // Initial fetch and auto-refresh timer
  useEffect(() => {
    fetchRunsAndStats();
  }, [fetchRunsAndStats]);

  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const timer = setInterval(() => {
      fetchRunsAndStats(false);
    }, autoRefreshInterval);
    return () => clearInterval(timer);
  }, [autoRefreshInterval, fetchRunsAndStats]);

  // Fetch specific instance details when inspector opens
  const fetchInstanceDetails = useCallback(async (instanceId: string) => {
    setLoadingInspect(true);
    try {
      const res = await fetch(`/api/workflows/instance/${encodeURIComponent(instanceId)}`);
      if (res.ok) {
        const data = await res.json();
        setInspectDetails(data);
      }
    } catch (err) {
      console.error('[JobsMonitor] Error fetching instance details:', err);
    } finally {
      setLoadingInspect(false);
    }
  }, []);

  useEffect(() => {
    if (selectedInstanceId) {
      fetchInstanceDetails(selectedInstanceId);
      // Auto-poll while inspecting active instance
      const pollTimer = setInterval(() => {
        fetchInstanceDetails(selectedInstanceId);
      }, 2000);
      return () => clearInterval(pollTimer);
    } else {
      setInspectDetails(null);
    }
  }, [selectedInstanceId, fetchInstanceDetails]);

  // Copy helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Workflow Control Actions
  const handlePause = async (instanceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/workflows/instance/${encodeURIComponent(instanceId)}/pause`, { method: 'POST' });
      if (res.ok) {
        setActionMessage({ text: `Instance ${instanceId} paused successfully`, type: 'success' });
        fetchRunsAndStats();
        if (selectedInstanceId === instanceId) fetchInstanceDetails(instanceId);
      }
    } catch (e: any) {
      setActionMessage({ text: `Failed to pause: ${e.message}`, type: 'error' });
    }
  };

  const handleResume = async (instanceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/workflows/instance/${encodeURIComponent(instanceId)}/resume`, { method: 'POST' });
      if (res.ok) {
        setActionMessage({ text: `Instance ${instanceId} resumed successfully`, type: 'success' });
        fetchRunsAndStats();
        if (selectedInstanceId === instanceId) fetchInstanceDetails(instanceId);
      }
    } catch (e: any) {
      setActionMessage({ text: `Failed to resume: ${e.message}`, type: 'error' });
    }
  };

  const handleRestart = async (instanceId: string, fromStep?: string | number) => {
    try {
      const res = await fetch(`/api/workflows/instance/${encodeURIComponent(instanceId)}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromStep }),
      });
      if (res.ok) {
        setActionMessage({ text: `Instance ${instanceId} restarted successfully`, type: 'success' });
        fetchRunsAndStats();
        if (selectedInstanceId === instanceId) fetchInstanceDetails(instanceId);
      }
    } catch (e: any) {
      setActionMessage({ text: `Failed to restart: ${e.message}`, type: 'error' });
    }
  };

  const handleTerminate = async (instanceId: string, rollback: boolean = false) => {
    if (!confirm(`Are you sure you want to terminate instance ${instanceId}${rollback ? ' with Saga rollback compensation' : ''}?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/workflows/instance/${encodeURIComponent(instanceId)}/terminate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rollback }),
      });
      if (res.ok) {
        setActionMessage({ text: `Instance ${instanceId} terminated`, type: 'success' });
        fetchRunsAndStats();
        if (selectedInstanceId === instanceId) fetchInstanceDetails(instanceId);
      }
    } catch (e: any) {
      setActionMessage({ text: `Failed to terminate: ${e.message}`, type: 'error' });
    }
  };

  const handleSendEvent = async (instanceId: string) => {
    if (!eventInput.trim()) return;
    setDispatchingEvent(true);
    try {
      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(eventPayload);
      } catch (e) {
        parsedPayload = { raw: eventPayload };
      }

      const res = await fetch(`/api/workflows/instance/${encodeURIComponent(instanceId)}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventName: eventInput.trim(),
          payload: parsedPayload,
        }),
      });

      if (res.ok) {
        setActionMessage({ text: `Event '${eventInput}' sent to instance ${instanceId}`, type: 'success' });
        fetchRunsAndStats();
        fetchInstanceDetails(instanceId);
      }
    } catch (e: any) {
      setActionMessage({ text: `Error sending event: ${e.message}`, type: 'error' });
    } finally {
      setDispatchingEvent(false);
    }
  };

  const handleTriggerJob = async () => {
    setTriggering(true);
    setActionMessage(null);
    try {
      let payload: any = {};
      if (selectedTriggerWorkflow === 'embedding-route-migration') {
        payload = {
          ticker: triggerParams.ticker || 'NVDA',
          sourceRouteKey: triggerParams.sourceRouteKey || 'docs:reembedded:v1',
          targetRouteKey: triggerParams.targetRouteKey || 'docs:workers-ai-bge:v1',
          targetEmbeddingSpaceKey: triggerParams.targetEmbeddingSpaceKey || 'workers-ai:bge-base-en-v1.5:768:mean:v1',
          targetDimensions: Number(triggerParams.targetDimensions) || 768,
          provider: triggerParams.provider || 'workers-ai',
          model: triggerParams.model || '@cf/baai/bge-base-en-v1.5',
        };
      } else if (selectedTriggerWorkflow === 'repo-index-pipeline') {
        payload = {
          repoName: triggerParams.repoName || 'AgentSamFast/core',
          workspaceId: triggerParams.workspaceId || 'ws_prod_01',
          commitSha: 'c7a4e9f801b',
          files: [
            { path: 'src/lib/routing/policyRouter.ts', content: '// Policy Router implementation\nexport const route = () => {};\n' },
            { path: 'src/backend/ai/embeddings/canonicalRepositories.ts', content: '// Canonical chunk and projection repository\n' },
            { path: 'server/lib/repoIntelligence/repoHistorian.ts', content: '// Codebase analytics engine\n' },
          ],
        };
      } else if (selectedTriggerWorkflow === 'workspace-provisioning') {
        payload = {
          workspaceId: 'ws_' + Math.random().toString(36).substring(2, 9),
          name: triggerParams.workspaceName || 'Enterprise Analytics Workspace',
          tenantId: 'tenant_alpha',
        };
      } else if (selectedTriggerWorkflow === 'approval-gate-flow') {
        payload = {
          dossierId: 'dos_' + Math.random().toString(36).substring(2, 9),
          ticker: triggerParams.ticker || 'NVDA',
          urgency: 'high',
        };
      }

      const res = await fetch('/api/workflows/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowName: selectedTriggerWorkflow,
          params: payload,
          triggerSource: 'api',
          workspaceId: triggerParams.workspaceId || 'default_workspace',
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || 'Failed to dispatch workflow');
      }

      const runSummary = await res.json();
      setActionMessage({ text: `Dispatched ${selectedTriggerWorkflow} (ID: ${runSummary.instanceId})`, type: 'success' });
      setIsTriggerModalOpen(false);
      fetchRunsAndStats();
      setSelectedInstanceId(runSummary.instanceId);
    } catch (e: any) {
      setActionMessage({ text: `Failed to trigger: ${e.message}`, type: 'error' });
    } finally {
      setTriggering(false);
    }
  };

  // Helper formatting functions
  const formatDuration = (created: string, completed?: string) => {
    if (!created) return '-';
    const start = new Date(created).getTime();
    const end = completed ? new Date(completed).getTime() : Date.now();
    const diffMs = Math.max(0, end - start);
    if (diffMs < 1000) return `${diffMs}ms`;
    if (diffMs < 60000) return `${(diffMs / 1000).toFixed(1)}s`;
    return `${(diffMs / 60000).toFixed(1)}m`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
            Running
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Completed
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <ShieldAlert className="w-3.5 h-3.5" />
            Failed
          </span>
        );
      case 'paused':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <Pause className="w-3.5 h-3.5" />
            Paused
          </span>
        );
      case 'waiting_for_event':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-300 border border-purple-500/30">
            <Clock className="w-3.5 h-3.5" />
            Waiting on Event
          </span>
        );
      case 'rolled_back':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/30">
            <RotateCw className="w-3.5 h-3.5" />
            Rolled Back (Saga)
          </span>
        );
      case 'terminated':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-stone-700/50 text-stone-400 border border-stone-600">
            <StopCircle className="w-3.5 h-3.5" />
            Terminated
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-stone-800 text-stone-300 border border-stone-700">
            {status}
          </span>
        );
    }
  };

  const getWorkflowCategoryIcon = (workflowName: string) => {
    if (workflowName.includes('embedding')) return <Database className="w-4 h-4 text-emerald-400" />;
    if (workflowName.includes('repo')) return <GitBranch className="w-4 h-4 text-cyan-400" />;
    if (workflowName.includes('provisioning')) return <Cpu className="w-4 h-4 text-indigo-400" />;
    if (workflowName.includes('approval')) return <Clock className="w-4 h-4 text-purple-400" />;
    return <Layers className="w-4 h-4 text-stone-400" />;
  };

  const parseJsonSafe = (raw?: string) => {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  return (
    <div id="durable-jobs-monitor" className="flex-1 flex flex-col h-full overflow-hidden bg-stone-950 text-stone-100 font-sans">
      {/* Action / Notification Banner */}
      {actionMessage && (
        <div
          id="monitor-action-notification"
          className={`px-4 py-2 text-xs flex items-center justify-between border-b transition-all ${
            actionMessage.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-800/80 text-emerald-200'
              : 'bg-rose-950/80 border-rose-800/80 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === 'success' ? <Check className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-rose-400" />}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="text-stone-400 hover:text-stone-100 p-0.5 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Top Header & Telemetry Cards */}
      <div className="p-4 sm:p-6 border-b border-stone-800 bg-stone-900/40 backdrop-blur-sm shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                  Durable Workflow Monitor
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-stone-800 text-stone-300 border border-stone-700">
                    D1 Control Plane
                  </span>
                </h1>
                <p className="text-xs text-stone-400 mt-0.5">
                  Tracks background durable executions (embeddings, repo-reindexing, backfills, saga rollbacks) in real time
                </p>
              </div>
            </div>
          </div>

          {/* Top Actions: Refresh & Dispatch */}
          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            {/* Auto-Refresh Select */}
            <div className="flex items-center gap-1.5 bg-stone-900 border border-stone-700/80 rounded-lg px-2.5 py-1.5 text-xs text-stone-300">
              <RefreshCw className={`w-3.5 h-3.5 text-stone-400 ${refreshing ? 'animate-spin text-emerald-400' : ''}`} />
              <span className="text-[11px] text-stone-400 hidden sm:inline">Poll:</span>
              <select
                id="monitor-poll-interval-select"
                value={autoRefreshInterval}
                onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                className="bg-transparent border-none outline-none text-xs text-stone-200 cursor-pointer"
              >
                <option value={2000} className="bg-stone-900">2s</option>
                <option value={3000} className="bg-stone-900">3s</option>
                <option value={5000} className="bg-stone-900">5s</option>
                <option value={10000} className="bg-stone-900">10s</option>
                <option value={0} className="bg-stone-900">Off</option>
              </select>
            </div>

            {/* Manual Refresh Button */}
            <button
              id="monitor-refresh-btn"
              onClick={() => fetchRunsAndStats(true)}
              disabled={refreshing}
              className="p-2 bg-stone-900 hover:bg-stone-800 border border-stone-700 rounded-lg text-stone-300 hover:text-white transition-colors"
              title="Refresh runs"
            >
              <RotateCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-emerald-400' : ''}`} />
            </button>

            {/* Dispatch Job Modal Trigger */}
            <button
              id="monitor-dispatch-job-btn"
              onClick={() => setIsTriggerModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-all active:scale-95"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Dispatch Job</span>
            </button>
          </div>
        </div>

        {/* Aggregate Telemetry Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3 bg-stone-900/80 border border-stone-800 rounded-xl">
            <div className="text-[11px] text-stone-400 font-medium">Total Workflow Runs</div>
            <div className="text-xl font-bold text-white font-mono mt-1">
              {stats?.totalRuns ?? runs.length}
            </div>
          </div>

          <div className="p-3 bg-stone-900/80 border border-sky-900/30 rounded-xl">
            <div className="text-[11px] text-sky-400 font-medium flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
              Active Running
            </div>
            <div className="text-xl font-bold text-sky-300 font-mono mt-1">
              {stats?.running ?? runs.filter((r) => r.status === 'running').length}
            </div>
          </div>

          <div className="p-3 bg-stone-900/80 border border-emerald-900/30 rounded-xl">
            <div className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Completed
            </div>
            <div className="text-xl font-bold text-emerald-300 font-mono mt-1">
              {stats?.completed ?? runs.filter((r) => r.status === 'completed').length}
            </div>
          </div>

          <div className="p-3 bg-stone-900/80 border border-rose-900/30 rounded-xl">
            <div className="text-[11px] text-rose-400 font-medium flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5" />
              Failed
            </div>
            <div className="text-xl font-bold text-rose-300 font-mono mt-1">
              {stats?.failed ?? runs.filter((r) => r.status === 'failed').length}
            </div>
          </div>

          <div className="p-3 bg-stone-900/80 border border-purple-900/30 rounded-xl">
            <div className="text-[11px] text-purple-300 font-medium flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Waiting on Event
            </div>
            <div className="text-xl font-bold text-purple-200 font-mono mt-1">
              {stats?.waiting_for_event ?? runs.filter((r) => r.status === 'waiting_for_event').length}
            </div>
          </div>

          <div className="p-3 bg-stone-900/80 border border-orange-900/30 rounded-xl">
            <div className="text-[11px] text-orange-400 font-medium flex items-center gap-1">
              <RotateCw className="w-3.5 h-3.5" />
              Saga Rolled Back
            </div>
            <div className="text-xl font-bold text-orange-300 font-mono mt-1">
              {stats?.rolled_back ?? runs.filter((r) => r.status === 'rolled_back').length}
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="px-4 sm:px-6 py-3 bg-stone-900/20 border-b border-stone-800/80 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        {/* Status Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 md:pb-0">
          {[
            { key: 'all', label: 'All' },
            { key: 'running', label: 'Running' },
            { key: 'completed', label: 'Completed' },
            { key: 'failed', label: 'Failed' },
            { key: 'waiting_for_event', label: 'Waiting Event' },
            { key: 'paused', label: 'Paused' },
          ].map((item) => (
            <button
              key={item.key}
              id={`filter-status-${item.key}`}
              onClick={() => setStatusFilter(item.key)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                statusFilter === item.key
                  ? 'bg-stone-800 text-white border border-stone-600 shadow-sm'
                  : 'text-stone-400 hover:text-stone-200 hover:bg-stone-900'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Search & Workflow Type Filter */}
        <div className="flex items-center gap-2">
          {/* Workflow Filter Dropdown */}
          <div className="relative">
            <select
              id="filter-workflow-select"
              value={workflowFilter}
              onChange={(e) => setWorkflowFilter(e.target.value)}
              className="bg-stone-900 border border-stone-700/80 rounded-lg px-2.5 py-1.5 text-xs text-stone-200 outline-none focus:border-emerald-500"
            >
              <option value="all">All Workflows</option>
              {definitions.map((def) => (
                <option key={def.workflowName} value={def.workflowName}>
                  {def.title || def.workflowName}
                </option>
              ))}
            </select>
          </div>

          {/* Search Box */}
          <div className="relative flex-1 md:w-64">
            <Search className="w-3.5 h-3.5 text-stone-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              id="monitor-search-input"
              type="text"
              placeholder="Search instance ID or params..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-stone-900 border border-stone-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-stone-100 placeholder-stone-500 outline-none focus:border-emerald-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Workflow Runs Table / List */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
        {loading && runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-stone-500 gap-3">
            <RefreshCw className="w-8 h-8 animate-spin text-emerald-500" />
            <span className="text-sm font-medium">Querying D1 workflow runs control plane...</span>
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-stone-500 border border-dashed border-stone-800 rounded-2xl p-8 text-center bg-stone-900/20">
            <Database className="w-10 h-10 text-stone-600 mb-2" />
            <h3 className="text-sm font-semibold text-stone-300">No Durable Workflow Runs Found</h3>
            <p className="text-xs text-stone-500 mt-1 max-w-sm">
              No workflow runs match the current filters. Dispatch an embedding migration, repo-indexing, or backfill job to begin tracking.
            </p>
            <button
              onClick={() => setIsTriggerModalOpen(true)}
              className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-all"
            >
              Dispatch First Job
            </button>
          </div>
        ) : (
          runs.map((run) => {
            const params = parseJsonSafe(run.params_json) || {};
            const errorData = parseJsonSafe(run.error_json);
            const progressPercent = run.total_steps > 0 ? Math.round((run.current_step_index / run.total_steps) * 100) : 0;

            return (
              <div
                key={run.id || run.external_instance_id}
                id={`workflow-run-${run.external_instance_id}`}
                onClick={() => setSelectedInstanceId(run.external_instance_id)}
                className={`p-4 rounded-xl border transition-all cursor-pointer bg-stone-900/60 hover:bg-stone-900 border-stone-800/90 hover:border-stone-700 shadow-sm relative group`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  {/* Left Column: Status, Workflow Name & Instance ID */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="p-2 rounded-lg bg-stone-800/80 border border-stone-700 text-stone-300 shrink-0 mt-0.5">
                      {getWorkflowCategoryIcon(run.external_workflow_name)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm text-white truncate">
                          {run.external_workflow_name}
                        </span>
                        {getStatusBadge(run.status)}
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-stone-800 text-stone-400 border border-stone-700">
                          {run.trigger_source}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-1 text-xs text-stone-400 font-mono">
                        <span className="text-stone-300">ID: {run.external_instance_id}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(run.external_instance_id, run.external_instance_id);
                          }}
                          className="text-stone-500 hover:text-stone-300 p-0.5"
                          title="Copy Instance ID"
                        >
                          {copiedId === run.external_instance_id ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                        <span className="text-stone-600">•</span>
                        <span>{new Date(run.created_at).toLocaleTimeString()}</span>
                        <span className="text-stone-600">•</span>
                        <span>Duration: {formatDuration(run.created_at, run.completed_at)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Middle Column: Progress Bar & Current Step */}
                  <div className="w-full lg:w-64 shrink-0 flex flex-col justify-center">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-stone-400">Step {run.current_step_index} of {run.total_steps}</span>
                      <span className="font-mono text-stone-300 font-medium">
                        {run.status === 'completed' ? '100%' : `${progressPercent}%`}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-stone-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 rounded-full ${
                          run.status === 'completed'
                            ? 'bg-emerald-500'
                            : run.status === 'failed'
                            ? 'bg-rose-500'
                            : run.status === 'waiting_for_event'
                            ? 'bg-purple-500'
                            : 'bg-sky-500'
                        }`}
                        style={{ width: `${run.status === 'completed' ? 100 : Math.max(8, progressPercent)}%` }}
                      />
                    </div>
                  </div>

                  {/* Right Column: Quick Action Controls */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-stone-800/80">
                    {run.status === 'running' && (
                      <button
                        onClick={(e) => handlePause(run.external_instance_id, e)}
                        className="px-2.5 py-1.5 bg-stone-800 hover:bg-amber-950/60 border border-stone-700 hover:border-amber-700 text-stone-300 hover:text-amber-300 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors"
                        title="Pause execution"
                      >
                        <Pause className="w-3.5 h-3.5" />
                        <span>Pause</span>
                      </button>
                    )}

                    {run.status === 'paused' && (
                      <button
                        onClick={(e) => handleResume(run.external_instance_id, e)}
                        className="px-2.5 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-800 text-emerald-300 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors"
                        title="Resume execution"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Resume</span>
                      </button>
                    )}

                    {run.status === 'waiting_for_event' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedInstanceId(run.external_instance_id);
                        }}
                        className="px-2.5 py-1.5 bg-purple-950/80 hover:bg-purple-900 border border-purple-800 text-purple-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors animate-pulse"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Approve Event</span>
                      </button>
                    )}

                    {(run.status === 'failed' || run.status === 'completed' || run.status === 'rolled_back') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRestart(run.external_instance_id);
                        }}
                        className="px-2.5 py-1.5 bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 hover:text-white rounded-lg text-xs font-medium flex items-center gap-1 transition-colors"
                        title="Restart workflow"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                        <span>Restart</span>
                      </button>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedInstanceId(run.external_instance_id);
                      }}
                      className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-200 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors"
                    >
                      <span>Inspect</span>
                      <ChevronRight className="w-3.5 h-3.5 text-stone-400" />
                    </button>
                  </div>
                </div>

                {/* Parameters Preview Pill Box */}
                {Object.keys(params).length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-stone-800/60 flex flex-wrap items-center gap-2 text-xs font-mono text-stone-400">
                    <span className="text-[11px] text-stone-500 uppercase tracking-wider font-sans">Params:</span>
                    {params.ticker && (
                      <span className="px-2 py-0.5 rounded bg-stone-800 text-emerald-400 border border-stone-700">
                        Ticker: {params.ticker}
                      </span>
                    )}
                    {params.targetEmbeddingSpaceKey && (
                      <span className="px-2 py-0.5 rounded bg-stone-800 text-stone-300 border border-stone-700 truncate max-w-xs">
                        Target: {params.targetEmbeddingSpaceKey}
                      </span>
                    )}
                    {params.repoName && (
                      <span className="px-2 py-0.5 rounded bg-stone-800 text-cyan-300 border border-stone-700">
                        Repo: {params.repoName}
                      </span>
                    )}
                    {params.workspaceId && (
                      <span className="px-2 py-0.5 rounded bg-stone-800 text-purple-300 border border-stone-700">
                        WS: {params.workspaceId}
                      </span>
                    )}
                    {errorData && (
                      <span className="px-2 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800 truncate max-w-sm">
                        Error: {errorData.message || errorData.error || String(errorData)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ========================================================================= */}
      {/* 1. Deep Step Inspector Drawer / Modal */}
      {/* ========================================================================= */}
      {selectedInstanceId && (
        <div
          id="workflow-step-inspector-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setSelectedInstanceId(null)}
        >
          <div
            className="w-full max-w-4xl max-h-[90vh] bg-stone-900 border border-stone-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-stone-800 flex items-center justify-between bg-stone-900/90">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-stone-800 border border-stone-700 text-emerald-400">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-white">
                      {inspectDetails?.workflowName || 'Workflow Instance'}
                    </h2>
                    {inspectDetails && getStatusBadge(inspectDetails.status)}
                  </div>
                  <div className="text-xs text-stone-400 font-mono mt-0.5 flex items-center gap-2">
                    <span>{selectedInstanceId}</span>
                    <button
                      onClick={() => handleCopy(selectedInstanceId, 'modal_id')}
                      className="text-stone-500 hover:text-stone-300"
                    >
                      {copiedId === 'modal_id' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchInstanceDetails(selectedInstanceId)}
                  disabled={loadingInspect}
                  className="p-2 text-stone-400 hover:text-stone-200 hover:bg-stone-800 rounded-lg transition-colors"
                  title="Refresh Step Logs"
                >
                  <RotateCw className={`w-4 h-4 ${loadingInspect ? 'animate-spin text-emerald-400' : ''}`} />
                </button>
                <button
                  onClick={() => setSelectedInstanceId(null)}
                  className="p-2 text-stone-400 hover:text-stone-200 hover:bg-stone-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
              {loadingInspect && !inspectDetails ? (
                <div className="flex flex-col items-center justify-center py-20 text-stone-500 gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-emerald-500" />
                  <span className="text-xs">Loading execution timeline & step payloads...</span>
                </div>
              ) : inspectDetails ? (
                <>
                  {/* Run Metadata Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-stone-950/60 p-3.5 rounded-xl border border-stone-800 text-xs font-mono">
                    <div>
                      <div className="text-stone-500 text-[11px] font-sans">Created At</div>
                      <div className="text-stone-200 mt-0.5">{new Date(inspectDetails.createdAt).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-stone-500 text-[11px] font-sans">Completed At</div>
                      <div className="text-stone-200 mt-0.5">
                        {inspectDetails.completedAt ? new Date(inspectDetails.completedAt).toLocaleString() : 'In Progress'}
                      </div>
                    </div>
                    <div>
                      <div className="text-stone-500 text-[11px] font-sans">Total Duration</div>
                      <div className="text-stone-200 mt-0.5 font-bold">
                        {formatDuration(inspectDetails.createdAt, inspectDetails.completedAt)}
                      </div>
                    </div>
                    <div>
                      <div className="text-stone-500 text-[11px] font-sans">Steps Executed</div>
                      <div className="text-stone-200 mt-0.5">
                        {inspectDetails.steps.length} / {inspectDetails.totalSteps}
                      </div>
                    </div>
                  </div>

                  {/* Waiting for Event Approval Box */}
                  {inspectDetails.status === 'waiting_for_event' && (
                    <div className="p-4 bg-purple-950/40 border border-purple-800 rounded-xl space-y-3">
                      <div className="flex items-center gap-2 text-purple-300 text-xs font-semibold">
                        <Clock className="w-4 h-4 animate-pulse" />
                        <span>Waiting on Event Approval: &apos;{inspectDetails.waitingEventName || 'human_approval'}&apos;</span>
                      </div>
                      <p className="text-xs text-purple-200/80">
                        This workflow is durably suspended waiting for an external approval event. Send the event payload below to resume.
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        <div>
                          <label className="text-[10px] text-stone-400 font-mono">Event Name:</label>
                          <input
                            type="text"
                            value={eventInput}
                            onChange={(e) => setEventInput(e.target.value)}
                            className="w-full bg-stone-900 border border-stone-700 rounded p-1.5 text-xs text-white font-mono mt-0.5"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-stone-400 font-mono">Payload JSON:</label>
                          <input
                            type="text"
                            value={eventPayload}
                            onChange={(e) => setEventPayload(e.target.value)}
                            className="w-full bg-stone-900 border border-stone-700 rounded p-1.5 text-xs text-white font-mono mt-0.5"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end pt-1">
                        <button
                          onClick={() => handleSendEvent(inspectDetails.instanceId)}
                          disabled={dispatchingEvent}
                          className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all"
                        >
                          {dispatchingEvent ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          <span>Dispatch Event & Resume</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step Logs Timeline */}
                  <div>
                    <h3 className="text-xs font-bold text-stone-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-emerald-400" />
                      Step Execution Logs & Full Payloads
                    </h3>

                    <div className="space-y-3">
                      {inspectDetails.steps.length === 0 ? (
                        <div className="p-6 text-center text-stone-500 border border-dashed border-stone-800 rounded-xl text-xs">
                          No step execution logs recorded yet.
                        </div>
                      ) : (
                        inspectDetails.steps.map((step, idx) => {
                          const isRollback = step.step_name.startsWith('rollback:');
                          const stepOutput = parseJsonSafe(step.output_json);
                          const stepInput = parseJsonSafe(step.input_json);
                          const stepError = parseJsonSafe(step.error_json);

                          return (
                            <div
                              key={step.id || idx}
                              className={`p-3.5 rounded-xl border transition-all ${
                                isRollback
                                  ? 'bg-orange-950/20 border-orange-800/40'
                                  : step.status === 'failed'
                                  ? 'bg-rose-950/20 border-rose-800/40'
                                  : 'bg-stone-950/60 border-stone-800'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="w-5 h-5 rounded-full bg-stone-800 text-stone-300 font-mono text-[11px] flex items-center justify-center font-bold">
                                    {idx + 1}
                                  </span>
                                  <span className="font-mono text-xs font-semibold text-stone-200">
                                    {step.step_name}
                                  </span>
                                  {step.attempt > 1 && (
                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-900/40 text-amber-400 border border-amber-800">
                                      Attempt #{step.attempt}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  {getStatusBadge(step.status)}
                                  {step.duration_ms !== undefined && (
                                    <span className="text-[11px] text-stone-400 font-mono">
                                      {step.duration_ms}ms
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Output / Result JSON display */}
                              {stepOutput && (
                                <div className="mt-2.5">
                                  <div className="text-[10px] text-stone-500 font-mono uppercase mb-1">
                                    Step Output:
                                  </div>
                                  <pre className="p-2.5 rounded bg-stone-900 text-emerald-300 font-mono text-[11px] overflow-x-auto max-h-48 no-scrollbar border border-stone-800">
                                    {typeof stepOutput === 'object' ? JSON.stringify(stepOutput, null, 2) : String(stepOutput)}
                                  </pre>
                                </div>
                              )}

                              {/* Error display */}
                              {stepError && (
                                <div className="mt-2.5">
                                  <div className="text-[10px] text-rose-400 font-mono uppercase mb-1">
                                    Error Details:
                                  </div>
                                  <pre className="p-2.5 rounded bg-rose-950/40 text-rose-200 font-mono text-[11px] overflow-x-auto max-h-36 no-scrollbar border border-rose-800">
                                    {typeof stepError === 'object' ? JSON.stringify(stepError, null, 2) : String(stepError)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Input Parameters Box */}
                  <div>
                    <h3 className="text-xs font-bold text-stone-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-sky-400" />
                      Workflow Input Parameters
                    </h3>
                    <pre className="p-3 bg-stone-950 text-sky-300 font-mono text-xs rounded-xl border border-stone-800 overflow-x-auto max-h-48">
                      {JSON.stringify(inspectDetails.params || {}, null, 2)}
                    </pre>
                  </div>
                </>
              ) : null}
            </div>

            {/* Modal Footer Controls */}
            {inspectDetails && (
              <div className="p-4 border-t border-stone-800 bg-stone-900/90 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRestart(inspectDetails.instanceId)}
                    className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Restart from Beginning</span>
                  </button>

                  <button
                    onClick={() => handleTerminate(inspectDetails.instanceId, true)}
                    className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                  >
                    <StopCircle className="w-3.5 h-3.5" />
                    <span>Terminate & Compensate (Saga)</span>
                  </button>
                </div>

                <button
                  onClick={() => setSelectedInstanceId(null)}
                  className="px-4 py-1.5 bg-stone-800 hover:bg-stone-700 text-white rounded-lg text-xs font-medium"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. Dispatch Durable Job Modal */}
      {/* ========================================================================= */}
      {isTriggerModalOpen && (
        <div
          id="dispatch-job-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setIsTriggerModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl bg-stone-900 border border-stone-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 sm:p-5 border-b border-stone-800 flex items-center justify-between bg-stone-900/90">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Dispatch Durable Background Job</h2>
                  <p className="text-xs text-stone-400">
                    Triggers asynchronous orchestration with Cloudflare Queue fan-out & D1 receipts
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsTriggerModalOpen(false)}
                className="p-1.5 text-stone-400 hover:text-stone-200 hover:bg-stone-800 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">
              {/* Select Workflow Definition */}
              <div>
                <label className="text-xs font-semibold text-stone-300 block mb-1.5">
                  Select Workflow Type
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    {
                      key: 'embedding-route-migration',
                      title: 'Embedding Route Migration & Backfill',
                      desc: 'Multi-step projection backfill, dimension verification & atomic cutover',
                      icon: Database,
                    },
                    {
                      key: 'repo-index-pipeline',
                      title: 'Repo Indexing & Velocity Analysis',
                      desc: 'Codebase churn, metrics computation & vector queue fan-out',
                      icon: GitBranch,
                    },
                    {
                      key: 'workspace-provisioning',
                      title: 'Workspace Provisioning & Saga Rollback',
                      desc: 'D1, R2, KV provisioning with reverse compensation safety',
                      icon: Cpu,
                    },
                    {
                      key: 'approval-gate-flow',
                      title: 'Human Approval Gate Flow',
                      desc: 'Multi-step dossier synthesis with human-in-the-loop pause',
                      icon: Clock,
                    },
                  ].map((wf) => {
                    const Icon = wf.icon;
                    const isSelected = selectedTriggerWorkflow === wf.key;
                    return (
                      <div
                        key={wf.key}
                        onClick={() => setSelectedTriggerWorkflow(wf.key)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-950/40 border-emerald-500 text-white shadow-sm'
                            : 'bg-stone-950/40 border-stone-800 text-stone-400 hover:border-stone-700 hover:text-stone-200'
                        }`}
                      >
                        <div className="flex items-center gap-2 font-semibold text-xs text-stone-100">
                          <Icon className={`w-4 h-4 ${isSelected ? 'text-emerald-400' : 'text-stone-400'}`} />
                          <span>{wf.title}</span>
                        </div>
                        <p className="text-[11px] text-stone-400 mt-1 leading-relaxed">{wf.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Dynamic Parameters based on Workflow Type */}
              <div className="p-4 bg-stone-950/60 rounded-xl border border-stone-800 space-y-3">
                <div className="text-xs font-semibold text-stone-300 uppercase tracking-wider">
                  Configure Job Parameters
                </div>

                {selectedTriggerWorkflow === 'embedding-route-migration' && (
                  <div className="space-y-2.5 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-stone-400 block mb-1">Target Ticker:</label>
                        <select
                          value={triggerParams.ticker}
                          onChange={(e) => setTriggerParams({ ...triggerParams, ticker: e.target.value })}
                          className="w-full bg-stone-900 border border-stone-700 rounded-lg p-2 text-white font-mono"
                        >
                          <option value="NVDA">NVDA (NVIDIA)</option>
                          <option value="AAPL">AAPL (Apple)</option>
                          <option value="MSFT">MSFT (Microsoft)</option>
                          <option value="TSLA">TSLA (Tesla)</option>
                          <option value="GOOGL">GOOGL (Alphabet)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-stone-400 block mb-1">Target Embedding Space:</label>
                        <select
                          value={triggerParams.targetEmbeddingSpaceKey}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val.includes('768')) {
                              setTriggerParams({
                                ...triggerParams,
                                targetEmbeddingSpaceKey: val,
                                targetDimensions: 768,
                                provider: val.includes('workers-ai') ? 'workers-ai' : 'google',
                                model: val.includes('workers-ai') ? '@cf/baai/bge-base-en-v1.5' : 'models/text-embedding-004',
                              });
                            } else {
                              setTriggerParams({
                                ...triggerParams,
                                targetEmbeddingSpaceKey: val,
                                targetDimensions: 1536,
                                provider: 'openai',
                                model: 'text-embedding-3-small',
                              });
                            }
                          }}
                          className="w-full bg-stone-900 border border-stone-700 rounded-lg p-2 text-white font-mono text-xs"
                        >
                          <option value="workers-ai:bge-base-en-v1.5:768:mean:v1">Workers AI BGE (768-dim)</option>
                          <option value="google:text-embedding-004:768:mean:v1">Gemini text-embedding-004 (768-dim)</option>
                          <option value="openai:text-embedding-3-small:1536:mean:v1">OpenAI text-embedding-3 (1536-dim)</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-stone-400 pt-1">
                      <div>Dimensions: <span className="text-emerald-400">{triggerParams.targetDimensions || 768}</span></div>
                      <div>Provider: <span className="text-emerald-400">{triggerParams.provider || 'workers-ai'}</span></div>
                    </div>
                  </div>
                )}

                {selectedTriggerWorkflow === 'repo-index-pipeline' && (
                  <div className="space-y-2.5 text-xs">
                    <div>
                      <label className="text-stone-400 block mb-1">Target Repository Identifier:</label>
                      <input
                        type="text"
                        value={triggerParams.repoName}
                        onChange={(e) => setTriggerParams({ ...triggerParams, repoName: e.target.value })}
                        className="w-full bg-stone-900 border border-stone-700 rounded-lg p-2 text-white font-mono"
                        placeholder="AgentSamFast/core"
                      />
                    </div>
                    <div className="text-[11px] text-stone-400">
                      Computes codebase churn, hotspot detection, and dispatches chunk embedding messages to Cloudflare Queue.
                    </div>
                  </div>
                )}

                {selectedTriggerWorkflow === 'workspace-provisioning' && (
                  <div className="space-y-2.5 text-xs">
                    <div>
                      <label className="text-stone-400 block mb-1">Workspace Display Name:</label>
                      <input
                        type="text"
                        value={triggerParams.workspaceName}
                        onChange={(e) => setTriggerParams({ ...triggerParams, workspaceName: e.target.value })}
                        className="w-full bg-stone-900 border border-stone-700 rounded-lg p-2 text-white"
                        placeholder="Enterprise Analytics Alpha"
                      />
                    </div>
                  </div>
                )}

                {selectedTriggerWorkflow === 'approval-gate-flow' && (
                  <div className="space-y-2.5 text-xs">
                    <div className="text-stone-300">
                      This workflow executes initial extraction steps, automatically pauses on a durable <code className="text-purple-300 font-mono">waitForEvent</code> gate, and waits for your interactive approval.
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-stone-800 bg-stone-900/90 flex items-center justify-end gap-2">
              <button
                onClick={() => setIsTriggerModalOpen(false)}
                className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg text-xs font-medium"
              >
                Cancel
              </button>
              <button
                id="modal-confirm-dispatch-btn"
                onClick={handleTriggerJob}
                disabled={triggering}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all active:scale-95"
              >
                {triggering ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                <span>Launch Workflow Run</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
