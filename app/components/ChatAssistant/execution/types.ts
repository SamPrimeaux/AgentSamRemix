/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentPreviewArtifact } from '../types';

export type AgentToolTraceStatus = 'running' | 'done' | 'error';

/** One row in the Agent Sam tool / terminal execution timeline (SSE-driven + local actions). */
export type AgentToolTraceRow = {
  id: string;
  /** Stable id from SSE tool_call_id when present. */
  toolCallId?: string;
  /** Short label for the row header (tool name or user action). */
  toolName: string;
  status: AgentToolTraceStatus;
  /** Human-readable summary lines (primary UI). */
  lines: string[];
  /** Raw JSON payload for Details disclosure. */
  detailsJson?: string;
  /** Tool output JSON — kept separate from request detailsJson. */
  outputDetailsJson?: string;
  /** Optional smoke / debug object from browser lane. */
  smokeDebug?: Record<string, unknown> | null;
  durationMs?: number;
  startedAtLabel: string;
  isSql?: boolean;
  sqlRows?: Record<string, unknown>[];
  /** True when this row was created from the dashboard (syntax / run), not SSE. */
  local?: boolean;
  /** MCP / integration label for receipt header (default Agent Sam). */
  integrationLabel?: string;
  /** Terminal tool receipt — from tool JSON output. */
  connectionResolution?: string;
  connectionId?: string;
  execHost?: string;
  /** D1 agentsam_cad_jobs.id when a CAD/Meshy tool returns async work. */
  cadJobId?: string;
  /** Keep row live + polling until the CAD job reaches a terminal D1 status. */
  cadJobLive?: boolean;
};

export type ArtifactChipListProps = {
  artifacts: AgentPreviewArtifact[];
  onOpenArtifact: (a: AgentPreviewArtifact) => void;
  onOpenImageUrl?: (url: string) => void;
};
