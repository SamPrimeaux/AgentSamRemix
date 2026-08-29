/** Pure apply helpers for App shell status payloads (Wave 2 E3). */
import type { AgentNotificationRow } from '../components/StatusBar';
import { mapProblemsApiPayload, countProblemSeverities } from '../src/lib/mapAgentProblems';
import { coalesceLabel } from '../src/lib/coalesceLabel';

export function applyGitStatusPayloadToSetters(
  gitData: {
    branch?: string;
    repo?: string;
    repo_full_name?: string;
    ahead_by?: number | null;
    behind_by?: number | null;
    tracking_branch?: string;
    default_branch?: string;
  },
  set: {
    setGitBranch: (v: string) => void;
    setGitRepoFullName: (v: string) => void;
    setGitAhead: (v: number | null) => void;
    setGitBehind: (v: number | null) => void;
    setGitTrackingBranch: (v: string | null) => void;
  },
): void {
  const repo = gitData.repo_full_name
    ? coalesceLabel(gitData.repo_full_name, '')
    : gitData.repo
      ? coalesceLabel(gitData.repo, '')
      : '';
  const branchName = gitData.branch ? String(gitData.branch) : '';
  if (branchName) set.setGitBranch(branchName);
  if (repo) set.setGitRepoFullName(repo);
  if (gitData.ahead_by != null && Number.isFinite(Number(gitData.ahead_by))) {
    set.setGitAhead(Number(gitData.ahead_by));
  } else {
    set.setGitAhead(null);
  }
  if (gitData.behind_by != null && Number.isFinite(Number(gitData.behind_by))) {
    set.setGitBehind(Number(gitData.behind_by));
  } else {
    set.setGitBehind(null);
  }
  const track =
    gitData.tracking_branch != null && String(gitData.tracking_branch).trim()
      ? String(gitData.tracking_branch).trim()
      : gitData.default_branch != null && String(gitData.default_branch).trim()
        ? String(gitData.default_branch).trim()
        : null;
  set.setGitTrackingBranch(track);
}

export function applyProblemsPayloadToSetters(
  probData: Record<string, unknown>,
  set: {
    setSystemProblems: (v: any) => void;
    setErrorCount: (v: number) => void;
    setWarningCount: (v: number) => void;
  },
): void {
  const rows = mapProblemsApiPayload(probData as Parameters<typeof mapProblemsApiPayload>[0]);
  set.setSystemProblems(rows);
  const { errors, warnings } = countProblemSeverities(rows);
  set.setErrorCount(errors);
  set.setWarningCount(warnings);
}
