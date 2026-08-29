/** Code-index state types (ProjectDetail peel B1). */

import type { EmbedCostRollup } from './codeIndexFormat';

export type CodeIndexAst = {
  nodes?: number | null;
  edges?: number | null;
  files?: number | null;
  symbols?: number | null;
  linked_chunks?: number | null;
  total_chunks?: number | null;
  last_synced_at?: string | number | null;
  scope?: 'run' | 'workspace' | string | null;
  run_id?: string | null;
} | null;

export type CodeIndexJob = {
  id?: string;
  run_id?: string;
  status?: string;
  progress_percent?: number;
  stage?: string;
  readiness?: string;
  activated?: boolean;
  calls_written?: number;
  revision_sha?: string | null;
  file_count?: number;
  indexed_file_count?: number;
  chunk_count?: number;
  failed_file_count?: number;
  last_error?: string | null;
  mode?: string;
  source_type?: string;
} | null;

export type CodeIndexState = {
  loading: boolean;
  reindexing: boolean;
  phase: 'idle' | 'running' | 'ok' | 'error' | 'calls';
  progressPct: number;
  statusMsg: string | null;
  error: string | null;
  workspaceId: string | null;
  githubRepo: string | null;
  githubConnected: boolean;
  callsWritten: number;
  callsBackfilling: boolean;
  ast: CodeIndexAst;
  embedCost: EmbedCostRollup | null;
  job: CodeIndexJob;
};

export type PreviousCodeIndexRun = {
  run_id: string;
  status: string;
  stage: string | null;
  progress_percent: number;
  indexed_file_count: number;
  chunk_count: number;
  symbol_count: number;
  revision_sha: string | null;
  last_error: string | null;
  updated_at: string | null;
};

export type GithubRepoRow = {
  id?: number | string;
  full_name?: string;
  name?: string;
  default_branch?: string;
};

export const INITIAL_CODE_INDEX: CodeIndexState = {
  loading: true,
  reindexing: false,
  phase: 'idle',
  progressPct: 0,
  statusMsg: null,
  error: null,
  workspaceId: null,
  githubRepo: null,
  githubConnected: false,
  callsWritten: 0,
  callsBackfilling: false,
  ast: null,
  embedCost: null,
  job: null,
};
