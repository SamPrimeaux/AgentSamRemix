import React, { useEffect, useMemo, useRef, useState } from 'react';

import type {
  ApprovalRequest,
  ExecutionEvent,
  IAMUser,
  Mission,
  MissionGoal,
} from '../sdk/types';
import { MissionRuntime } from '../sdk/mission';

import { RepoIntelligenceView } from './intelligence/RepoIntelligenceView';
import { ExecutionLedger } from './workbench/ExecutionLedger';
import { ApprovalGateModal } from './workbench/ApprovalGateModal';
import { CodeModeRunner } from './workbench/CodeModeRunner';
import { CodeWorkspace } from './workspace/CodeWorkspace';

import { BrowserWorkbench } from '@iam/frontend/workbench/browser';

import {
  MODEL_TIER_CONFIGS,
  type ModelTier,
} from '../types/agentSam';

import type { RuntimeBinding } from '../types/bindings';

export type WorkbenchViewTab =
  | 'mission'
  | 'repository'
  | 'code'
  | 'browser';

export interface WorkbenchRepository {
  id: string;
  label?: string;
  defaultRef?: string;
}

export interface WorkbenchEnvironment {
  id: string;
  label: string;
  status?: 'ready' | 'starting' | 'offline' | 'error';
}

export interface WorkbenchAppProps {
  user: IAMUser;
  onLogout: () => void;

  /**
   * Runtime/bootstrap data belongs above the workbench.
   * WorkbenchApp consumes available resources; it does not invent them.
   */
  repositories?: WorkbenchRepository[];
  environments?: WorkbenchEnvironment[];
  runtimeBindings?: RuntimeBinding[];

  initialRepository?: string;
  initialRef?: string;
  initialEnvironment?: string;
  initialModel?: ModelTier;
  initialTab?: WorkbenchViewTab;
}

const WORKBENCH_TAB_META: Record<
  WorkbenchViewTab,
  { label: string; icon: string }
> = {
  mission: { label: 'Work', icon: 'bolt' },
  repository: { label: 'Repository', icon: 'account_tree' },
  code: { label: 'Code', icon: 'code' },
  browser: { label: 'Browser', icon: 'language' },
};

function firstModelTier(): ModelTier {
  return Object.keys(MODEL_TIER_CONFIGS)[0] as ModelTier;
}

function createGoalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `goal_${crypto.randomUUID()}`;
  }
  return `goal_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function missionTitle(input: string): string {
  const firstLine = input
    .split('\n')
    .map(line => line.trim())
    .find(Boolean);

  if (!firstLine) return 'Agent Sam mission';
  return firstLine.length > 120
    ? `${firstLine.slice(0, 117)}...`
    : firstLine;
}

const EmptyTarget: React.FC = () => (
  <div className="flex flex-1 items-center justify-center p-8">
    <div className="max-w-md text-center">
      <span className="material-symbols-outlined mb-3 text-3xl text-zinc-600">
        folder_open
      </span>
      <h2 className="text-sm font-semibold text-zinc-200">
        Choose a repository
      </h2>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        Connect or enter a repository above. Agent Sam will use the selected
        repository as the active work target.
      </p>
    </div>
  </div>
);

export const WorkbenchApp: React.FC<WorkbenchAppProps> = ({
  user,
  onLogout,
  repositories = [],
  environments = [],
  runtimeBindings = [],
  initialRepository,
  initialRef,
  initialEnvironment,
  initialModel,
  initialTab = 'mission',
}) => {
  const repositoryCatalog = useMemo(
    () =>
      repositories
        .filter(repo => repo?.id?.trim())
        .map(repo => ({
          ...repo,
          id: repo.id.trim(),
          label: repo.label?.trim() || repo.id.trim(),
        })),
    [repositories],
  );

  const environmentCatalog = useMemo(
    () => environments.filter(env => env?.id?.trim()),
    [environments],
  );

  const modelCatalog = useMemo(
    () => Object.values(MODEL_TIER_CONFIGS),
    [],
  );

  const initialRepo =
    initialRepository?.trim() ||
    repositoryCatalog[0]?.id ||
    '';

  const initialRepoMeta = repositoryCatalog.find(
    repo => repo.id === initialRepo,
  );

  const [activeTab, setActiveTab] =
    useState<WorkbenchViewTab>(initialTab);

  const [selectedRepo, setSelectedRepo] =
    useState<string>(initialRepo);

  const [activeRef, setActiveRef] = useState<string>(
    initialRef?.trim() ||
      initialRepoMeta?.defaultRef?.trim() ||
      '',
  );

  const [selectedEnvironment, setSelectedEnvironment] =
    useState<string>(
      initialEnvironment?.trim() ||
        environmentCatalog.find(env => env.status === 'ready')?.id ||
        environmentCatalog[0]?.id ||
        '',
    );

  const [selectedModel, setSelectedModel] =
    useState<ModelTier>(
      initialModel ||
        modelCatalog[0]?.id ||
        firstModelTier(),
    );

  const [missionInput, setMissionInput] = useState('');
  const [activeMission, setActiveMission] =
    useState<Mission | null>(null);
  const [events, setEvents] =
    useState<ExecutionEvent[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [runError, setRunError] =
    useState<string | null>(null);

  const [pendingApproval, setPendingApproval] =
    useState<ApprovalRequest | null>(null);

  const approvalResolverRef =
    useRef<((approved: boolean) => void) | null>(null);

  const [missionRuntime] = useState(
    () => new MissionRuntime(),
  );

  useEffect(() => {
    return missionRuntime.onEvent(event => {
      setEvents(previous => [...previous, event]);
    });
  }, [missionRuntime]);

  useEffect(() => {
    missionRuntime.setApprovalHandler(
      approval =>
        new Promise<boolean>(resolve => {
          approvalResolverRef.current?.(false);
          approvalResolverRef.current = resolve;
          setPendingApproval(approval);
        }),
    );

    return () => {
      approvalResolverRef.current?.(false);
      approvalResolverRef.current = null;
    };
  }, [missionRuntime]);

  useEffect(() => {
    if (selectedRepo || !repositoryCatalog[0]) return;

    setSelectedRepo(repositoryCatalog[0].id);

    if (!activeRef && repositoryCatalog[0].defaultRef) {
      setActiveRef(repositoryCatalog[0].defaultRef);
    }
  }, [repositoryCatalog, selectedRepo, activeRef]);

  useEffect(() => {
    if (
      selectedEnvironment ||
      !environmentCatalog[0]
    ) {
      return;
    }

    setSelectedEnvironment(
      environmentCatalog.find(
        env => env.status === 'ready',
      )?.id || environmentCatalog[0].id,
    );
  }, [environmentCatalog, selectedEnvironment]);

  const handleRepositoryChange = (value: string) => {
    const repo = value.trim();
    setSelectedRepo(repo);

    const catalogEntry = repositoryCatalog.find(
      item => item.id === repo,
    );

    if (catalogEntry?.defaultRef) {
      setActiveRef(catalogEntry.defaultRef);
    }
  };

  const settleApproval = (approved: boolean) => {
    const resolve = approvalResolverRef.current;

    approvalResolverRef.current = null;
    setPendingApproval(null);

    resolve?.(approved);
  };

  const startMission = async () => {
    const repo = selectedRepo.trim();
    const prompt = missionInput.trim();

    if (!repo) {
      setRunError('Choose a repository before starting work.');
      return;
    }

    if (!prompt) {
      setRunError('Describe the work you want Agent Sam to perform.');
      return;
    }

    setRunError(null);
    setEvents([]);
    setActiveMission(null);
    setIsExecuting(true);

    const goal: MissionGoal = {
      id: createGoalId(),
      title: missionTitle(prompt),
      description: prompt,
      targetRepo: repo,
      ...(activeRef.trim()
        ? { targetBranch: activeRef.trim() }
        : {}),
    };

    try {
      const result = await missionRuntime.run(goal, {
        ...(selectedEnvironment
          ? { environmentId: selectedEnvironment }
          : {}),
        modelTier: selectedModel,
      });

      setActiveMission(result);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Mission execution failed.';

      setRunError(message);
    } finally {
      setIsExecuting(false);
    }
  };

  const cancelMission = () => {
    missionRuntime.cancel();
    setIsExecuting(false);
  };

  const handleStartFromIntelligenceSignal = (
    title: string,
    recommendation: string,
  ) => {
    setMissionInput(
      [title.trim(), recommendation.trim()]
        .filter(Boolean)
        .join('\n\n'),
    );
    setActiveTab('mission');
  };

  const activeModel =
    MODEL_TIER_CONFIGS[selectedModel];

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[#0c0e12] text-zinc-100">
      <header className="shrink-0 border-b border-zinc-800/80 bg-zinc-950/95 backdrop-blur">
        <div className="flex min-h-12 items-center gap-3 px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
              <span className="material-symbols-outlined text-base text-zinc-300">
                terminal
              </span>
            </div>

            <span className="hidden text-sm font-semibold tracking-tight text-white sm:inline">
              Agent Sam
            </span>
          </div>

          <div className="h-5 w-px shrink-0 bg-zinc-800" />

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="material-symbols-outlined hidden text-sm text-zinc-500 sm:inline">
              folder_open
            </span>

            <input
              value={selectedRepo}
              onChange={event =>
                handleRepositoryChange(
                  event.target.value,
                )
              }
              list="agentsam-repositories"
              placeholder="owner/repository"
              aria-label="Active repository"
              className="min-w-0 flex-1 bg-transparent text-xs font-medium text-zinc-200 outline-none placeholder:text-zinc-600 sm:max-w-64"
            />

            <datalist id="agentsam-repositories">
              {repositoryCatalog.map(repo => (
                <option
                  key={repo.id}
                  value={repo.id}
                >
                  {repo.label}
                </option>
              ))}
            </datalist>

            <input
              value={activeRef}
              onChange={event =>
                setActiveRef(event.target.value)
              }
              placeholder="branch"
              aria-label="Repository branch"
              className="hidden w-28 rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1 text-[11px] font-mono text-zinc-300 outline-none focus:border-zinc-600 sm:block"
            />
          </div>

          {environmentCatalog.length > 0 ? (
            <select
              value={selectedEnvironment}
              onChange={event =>
                setSelectedEnvironment(
                  event.target.value,
                )
              }
              aria-label="Execution environment"
              className="hidden max-w-44 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 outline-none lg:block"
            >
              {environmentCatalog.map(env => (
                <option
                  key={env.id}
                  value={env.id}
                >
                  {env.label}
                  {env.status
                    ? ` · ${env.status}`
                    : ''}
                </option>
              ))}
            </select>
          ) : (
            <span className="hidden rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-500 lg:inline">
              runtime auto
            </span>
          )}

          <select
            value={selectedModel}
            onChange={event =>
              setSelectedModel(
                event.target.value as ModelTier,
              )
            }
            aria-label="Model"
            className="hidden max-w-48 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 outline-none xl:block"
          >
            {modelCatalog.map(model => (
              <option
                key={model.id}
                value={model.id}
              >
                {model.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 border-l border-zinc-800 pl-2">
            <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-800 text-xs font-semibold text-zinc-300">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                user.name?.charAt(0) || '?'
              )}
            </div>

            <button
              type="button"
              onClick={onLogout}
              title="Sign out"
              aria-label="Sign out"
              className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
            >
              <span className="material-symbols-outlined text-base">
                logout
              </span>
            </button>
          </div>
        </div>

        <nav className="flex min-h-10 items-end gap-1 overflow-x-auto px-2 sm:px-4">
          {(Object.keys(
            WORKBENCH_TAB_META,
          ) as WorkbenchViewTab[]).map(tab => {
            const meta =
              WORKBENCH_TAB_META[tab];

            const active = activeTab === tab;

            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  active
                    ? 'border-sky-400 text-white'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <span className="material-symbols-outlined text-sm">
                  {meta.icon}
                </span>
                {meta.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === 'mission' && (
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <section className="flex min-h-0 flex-1 flex-col border-r border-zinc-800/70">
              <div className="shrink-0 border-b border-zinc-800/70 p-3 sm:p-4">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
                  <textarea
                    value={missionInput}
                    onChange={event =>
                      setMissionInput(
                        event.target.value,
                      )
                    }
                    placeholder="What should Agent Sam do?"
                    rows={3}
                    className="w-full resize-none bg-transparent text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-600"
                  />

                  {runError && (
                    <div className="mt-2 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
                      {runError}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-[10px] text-zinc-500">
                      {selectedRepo && (
                        <span className="max-w-56 truncate rounded-md bg-zinc-950 px-2 py-1 font-mono">
                          {selectedRepo}
                        </span>
                      )}

                      {activeRef && (
                        <span className="rounded-md bg-zinc-950 px-2 py-1 font-mono">
                          {activeRef}
                        </span>
                      )}

                      {activeModel && (
                        <span className="rounded-md bg-zinc-950 px-2 py-1">
                          {activeModel.name}
                        </span>
                      )}
                    </div>

                    {isExecuting ? (
                      <button
                        type="button"
                        onClick={cancelMission}
                        className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                      >
                        Stop
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={startMission}
                        disabled={
                          !missionInput.trim() ||
                          !selectedRepo.trim()
                        }
                        className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Run
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
                <ExecutionLedger
                  events={events}
                  isStreaming={isExecuting}
                />
              </div>
            </section>

            <aside className="w-full shrink-0 border-t border-zinc-800/70 bg-zinc-950/70 lg:w-80 lg:border-l-0 lg:border-t-0">
              <div className="h-full overflow-y-auto p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    Run
                  </h2>

                  <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    {activeMission?.state ||
                      (isExecuting
                        ? 'starting'
                        : 'idle')}
                  </span>
                </div>

                {activeMission ? (
                  <>
                    <div className="space-y-1.5">
                      {activeMission.plan.map(
                        (step, index) => (
                          <div
                            key={step.id}
                            className="flex gap-2 rounded-md px-2 py-1.5 text-xs"
                          >
                            <span className="w-5 shrink-0 font-mono text-zinc-600">
                              {String(
                                index + 1,
                              ).padStart(2, '0')}
                            </span>

                            <span
                              className={
                                step.status ===
                                'completed'
                                  ? 'text-zinc-500'
                                  : step.status ===
                                      'in_progress'
                                    ? 'text-white'
                                    : 'text-zinc-400'
                              }
                            >
                              {step.title}
                            </span>
                          </div>
                        ),
                      )}
                    </div>

                    <div className="mt-5 space-y-2 border-t border-zinc-800 pt-4 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">
                          Tool calls
                        </span>
                        <span className="font-mono text-zinc-300">
                          {
                            activeMission.toolCallCount
                          }
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-zinc-500">
                          Input
                        </span>
                        <span className="font-mono text-zinc-300">
                          {activeMission.totalTokens.input.toLocaleString()}
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-zinc-500">
                          Output
                        </span>
                        <span className="font-mono text-zinc-300">
                          {activeMission.totalTokens.output.toLocaleString()}
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-zinc-500">
                          Cost
                        </span>
                        <span className="font-mono text-zinc-300">
                          $
                          {activeMission.totalCostUsd.toFixed(
                            4,
                          )}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-xs leading-5 text-zinc-600">
                    Mission state, plan, usage and
                    execution receipts will appear here
                    when a run starts.
                  </p>
                )}
              </div>
            </aside>
          </div>
        )}

        {activeTab === 'repository' &&
          (selectedRepo ? (
            <RepoIntelligenceView
              repoName={selectedRepo}
              onStartMissionForSignal={
                handleStartFromIntelligenceSignal
              }
            />
          ) : (
            <EmptyTarget />
          ))}

        {activeTab === 'code' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <CodeWorkspace
                bindings={runtimeBindings}
              />
            </div>

            <div className="shrink-0 border-t border-zinc-800">
              <CodeModeRunner />
            </div>
          </div>
        )}

        {activeTab === 'browser' && (
          <div className="min-h-0 flex-1">
            <BrowserWorkbench
              agentRunId={
                activeMission?.id || null
              }
            />
          </div>
        )}
      </main>

      <ApprovalGateModal
        request={pendingApproval}
        onApprove={() =>
          settleApproval(true)
        }
        onReject={() =>
          settleApproval(false)
        }
      />
    </div>
  );
};

export default WorkbenchApp;
