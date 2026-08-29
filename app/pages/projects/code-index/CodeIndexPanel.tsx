/** Codebase index rail panel (ProjectDetail peel B1). */

import React from 'react';
import { ChevronDown, ChevronRight, Github, RefreshCw } from 'lucide-react';
import { formatEmbedSpendLine, relativeTimeLabel } from './codeIndexFormat';
import { CodeIndexGithubPicker } from './CodeIndexGithubPicker';
import { CodeIndexRailSection } from './CodeIndexRailSection';
import type { ProjectCodeIndexApi } from './useProjectCodeIndex';

export type CodeIndexPanelProps = ProjectCodeIndexApi & {
  projectId: string | undefined;
  defaultOpen?: boolean;
};

export function CodeIndexPanel({
  projectId,
  defaultOpen = true,
  codeIndex,
  githubPickerOpen,
  setGithubPickerOpen,
  githubReposLoading,
  githubReposAuthed,
  githubRepoSearch,
  setGithubRepoSearch,
  githubConnectBusy,
  githubRepoLabelExpanded,
  setGithubRepoLabelExpanded,
  selectedCodeIndexRunId,
  previousRunsOpen,
  setPreviousRunsOpen,
  previousCodeIndexRuns,
  filteredGithubRepos,
  openGithubPicker,
  connectProjectGithubRepo,
  disconnectProjectGithubRepo,
  cancelProjectFullReindex,
  resumeProjectFullReindex,
  reindexProjectFull,
  reindexProjectIncremental,
  selectPreviousRun,
}: CodeIndexPanelProps) {
  return (
    <CodeIndexRailSection
        title="Codebase index"
        defaultOpen={defaultOpen}
        action={
          <div className="cpd-rail-actions">
            <button
              type="button"
              className="cpd-icon-btn"
              title={
                codeIndex.githubConnected
                  ? 'Change GitHub repo'
                  : 'Connect GitHub repo'
              }
              disabled={codeIndex.reindexing || githubConnectBusy}
              onClick={() => (githubPickerOpen ? setGithubPickerOpen(false) : openGithubPicker())}
            >
              <Github size={13} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className="cpd-icon-btn"
              title={
                codeIndex.githubConnected
                  ? codeIndex.reindexing || codeIndex.phase === 'running'
                    ? 'Index running — use Stop below'
                    : 'Full Build (entire repo). Prefer Update for day-to-day sync.'
                  : 'Connect a GitHub repo first'
              }
              disabled={
                codeIndex.reindexing ||
                codeIndex.phase === 'running' ||
                codeIndex.loading
              }
              onClick={() => void reindexProjectFull()}
            >
              <RefreshCw
                size={13}
                strokeWidth={1.5}
                className={
                  codeIndex.reindexing || codeIndex.phase === 'running'
                    ? 'cpd-spin'
                    : undefined
                }
              />
            </button>
          </div>
        }
      >
        {codeIndex.loading ? (
          <p className="cpd-rail-preview-empty">Loading index…</p>
        ) : codeIndex.error && !codeIndex.ast && codeIndex.githubConnected ? (
          <p className="cpd-rail-preview-empty">{codeIndex.error}</p>
        ) : (
          <div className="cpd-code-index">
            {!codeIndex.githubConnected ? (
              <div className="cpd-gh-empty">
                <p className="cpd-rail-preview-empty">
                  Connect a GitHub repository to index and search this project&apos;s code.
                </p>
                <button
                  type="button"
                  className="cpd-gh-connect-btn"
                  disabled={githubConnectBusy}
                  onClick={() => openGithubPicker()}
                >
                  <Github size={14} strokeWidth={1.5} />
                  Connect GitHub repo
                </button>
              </div>
            ) : (
              <>
                <div className="cpd-gh-bound">
                  <button
                    type="button"
                    className={
                      githubRepoLabelExpanded
                        ? 'cpd-gh-bound-repo cpd-gh-bound-repo--expanded'
                        : 'cpd-gh-bound-repo'
                    }
                    title={
                      codeIndex.githubRepo
                        ? `${codeIndex.githubRepo} — click to ${githubRepoLabelExpanded ? 'collapse' : 'expand'}`
                        : undefined
                    }
                    aria-expanded={githubRepoLabelExpanded}
                    aria-label={
                      codeIndex.githubRepo
                        ? `GitHub repo ${codeIndex.githubRepo}`
                        : 'GitHub repo'
                    }
                    onClick={() => setGithubRepoLabelExpanded((v) => !v)}
                  >
                    {codeIndex.githubRepo}
                  </button>
                  <div className="cpd-gh-bound-actions">
                    <button
                      type="button"
                      className="cpd-gh-link-btn"
                      disabled={codeIndex.reindexing || githubConnectBusy}
                      onClick={() => openGithubPicker()}
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      className="cpd-gh-link-btn"
                      disabled={codeIndex.reindexing || githubConnectBusy}
                      onClick={() => void disconnectProjectGithubRepo()}
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
                <div className="cpd-code-index-controls" role="group" aria-label="Index controls">
                  {codeIndex.reindexing ||
                  codeIndex.phase === 'running' ||
                  codeIndex.callsBackfilling ||
                  ['idle', 'running', 'queued'].includes(
                    String(codeIndex.job?.status || '').toLowerCase(),
                  ) ? (
                    <button
                      type="button"
                      className="cpd-code-index-ctrl cpd-code-index-ctrl--stop"
                      onClick={() => void cancelProjectFullReindex()}
                    >
                      Stop
                    </button>
                  ) : null}
                  {!codeIndex.reindexing &&
                  codeIndex.phase !== 'running' &&
                  !codeIndex.callsBackfilling ? (
                    <button
                      type="button"
                      className="cpd-code-index-ctrl cpd-code-index-ctrl--continue"
                      disabled={codeIndex.loading || !codeIndex.githubConnected}
                      onClick={() => void reindexProjectIncremental()}
                      title="Incremental update — only files changed since the activated baseline (not a full crawl)"
                    >
                      Update
                    </button>
                  ) : null}
                  {!codeIndex.reindexing &&
                  codeIndex.phase !== 'running' &&
                  (codeIndex.job?.status === 'cancelled' ||
                    codeIndex.job?.status === 'failed' ||
                    (codeIndex.statusMsg || '').toLowerCase().includes('stopped') ||
                    String(codeIndex.error || '').includes('index_stopped') ||
                    String(codeIndex.job?.stage || '').includes('verify_failed')) ? (
                    <>
                      <button
                        type="button"
                        className="cpd-code-index-ctrl cpd-code-index-ctrl--continue"
                        disabled={codeIndex.loading || !codeIndex.githubConnected}
                        onClick={() => void resumeProjectFullReindex()}
                        title="Resume the same run_id from its embed/crawl checkpoint"
                      >
                        Continue
                      </button>
                      <button
                        type="button"
                        className="cpd-code-index-ctrl"
                        disabled={codeIndex.loading || !codeIndex.githubConnected}
                        onClick={() => void reindexProjectFull({ force: true })}
                        title="New full index under the live tree-sitter parser (js/py/go) — does not resume the stopped checkpoint"
                      >
                        Restart
                      </button>
                    </>
                  ) : null}
                </div>
                <div className="cpd-code-index-top">
                  <div className="cpd-code-index-grid">
                    <div
                      title={
                        codeIndex.ast?.scope === 'run'
                          ? 'This run: distinct files linked to the current index job'
                          : 'Store: distinct files in the AST graph (workspace-wide until a full run exists)'
                      }
                    >
                      <span className="cpd-code-index-label">Store</span>
                      <span className="cpd-code-index-val">{codeIndex.ast?.files ?? '—'}</span>
                    </div>
                    <div
                      title={
                        codeIndex.ast?.scope === 'run'
                          ? 'This run: AST nodes for the current index job only'
                          : 'AST graph nodes (workspace-wide — may include older jobs)'
                      }
                    >
                      <span className="cpd-code-index-label">Nodes</span>
                      <span className="cpd-code-index-val">{codeIndex.ast?.nodes ?? '—'}</span>
                    </div>
                    <div
                      title={
                        codeIndex.ast?.scope === 'run'
                          ? 'This run: embedded symbols with matching run_id (orphans excluded)'
                          : 'Embedded symbols (workspace-wide — may include orphan run_id=null rows)'
                      }
                    >
                      <span className="cpd-code-index-label">Symbols</span>
                      <span className="cpd-code-index-val">{codeIndex.ast?.symbols ?? '—'}</span>
                    </div>
                    <div
                      title={
                        codeIndex.ast?.scope === 'run'
                          ? 'This run: chunks linked to structural symbols'
                          : 'Chunks linked to structural symbols (workspace-wide)'
                      }
                    >
                      <span className="cpd-code-index-label">Linked</span>
                      <span className="cpd-code-index-val">
                        {codeIndex.ast?.total_chunks != null && Number(codeIndex.ast.total_chunks) === 0
                          ? 'none'
                          : codeIndex.ast?.linked_chunks != null
                            ? `${codeIndex.ast.linked_chunks}/${codeIndex.ast.total_chunks ?? '—'}`
                            : '—'}
                      </span>
                    </div>
                  </div>
                  {(() => {
                    const fullyDone =
                      codeIndex.phase === 'calls' ||
                      (codeIndex.phase === 'ok' && !codeIndex.callsBackfilling);
                    const level2Done =
                      codeIndex.phase === 'calls' ||
                      (fullyDone && codeIndex.callsWritten > 0);
                    const ringPhase = codeIndex.callsBackfilling
                      ? 'running'
                      : level2Done
                        ? 'calls'
                        : fullyDone
                          ? 'ok'
                          : codeIndex.phase;
                    return (
                      <div
                        className={`cpd-code-ring cpd-code-ring--${ringPhase}`}
                        style={
                          {
                            ['--pct' as string]: String(
                              Math.max(
                                0,
                                Math.min(
                                  100,
                                  codeIndex.progressPct ||
                                    (fullyDone || level2Done ? 100 : 0),
                                ),
                              ),
                            ),
                          } as React.CSSProperties
                        }
                        title={
                          codeIndex.callsBackfilling
                            ? codeIndex.statusMsg || 'Writing call-graph edges…'
                            : level2Done
                              ? `Index complete · ${codeIndex.callsWritten} call edges`
                              : fullyDone
                                ? 'Index complete'
                                : codeIndex.statusMsg || 'Index status'
                        }
                        aria-label={codeIndex.statusMsg || `Index ${codeIndex.progressPct}%`}
                      >
                        <span className="cpd-code-ring-pct">
                          {codeIndex.phase === 'running' || codeIndex.callsBackfilling ? (
                            `${Math.max(1, Math.min(99, codeIndex.progressPct || 1))}%`
                          ) : level2Done || fullyDone ? (
                            '✓'
                          ) : codeIndex.phase === 'error' ? (
                            '!'
                          ) : codeIndex.progressPct > 0 && codeIndex.progressPct < 100 ? (
                            `${codeIndex.progressPct}%`
                          ) : (
                            '•'
                          )}
                        </span>
                      </div>
                    );
                  })()}
                </div>
                <p className="cpd-code-index-meta">
                  {codeIndex.workspaceId ? (
                    <>
                      <span className="cpd-code-index-ws">{codeIndex.workspaceId}</span>
                      {' · '}
                    </>
                  ) : null}
                  Last sync{' '}
                  {codeIndex.ast?.last_synced_at
                    ? relativeTimeLabel(codeIndex.ast.last_synced_at)
                    : '—'}
                  {codeIndex.embedCost != null ? (
                    <>
                      {' '}
                      ·{' '}
                      <span
                        title={
                          codeIndex.embedCost.this_run_id ||
                          codeIndex.embedCost.cost_usd_this_run != null
                            ? 'This run = usage ref_id for the active full-index job (tokens × list price). Today = UTC-day embed spend (matches OpenAI Usage day bars more closely; includes cancelled restarts).'
                            : 'UTC-day / 30d embedding spend for this workspace'
                        }
                      >
                        {formatEmbedSpendLine(codeIndex.embedCost)}
                      </span>
                    </>
                  ) : null}
                </p>
                {codeIndex.statusMsg ? (
                  <p
                    className={`cpd-code-index-status cpd-code-index-status--${
                      codeIndex.phase === 'calls' ? 'ok' : codeIndex.phase
                    }`}
                  >
                    {codeIndex.statusMsg}
                  </p>
                ) : null}
                {codeIndex.phase === 'error' && codeIndex.error ? (
                  <p
                    className="cpd-code-index-status cpd-code-index-status--error"
                    title={String(codeIndex.error)}
                  >
                    {String(codeIndex.error).slice(0, 280)}
                  </p>
                ) : null}
                {previousCodeIndexRuns.length > 0 ? (
                  <div className="cpd-code-index-prev-foot">
                    <button
                      type="button"
                      className="cpd-code-index-prev-toggle"
                      aria-expanded={previousRunsOpen}
                      onClick={() => setPreviousRunsOpen((open) => !open)}
                    >
                      <span>Previous runs</span>
                      <span className="cpd-code-index-prev-toggle-meta">
                        {previousCodeIndexRuns.length}
                        {previousRunsOpen ? (
                          <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
                        ) : (
                          <ChevronRight size={12} strokeWidth={1.75} aria-hidden />
                        )}
                      </span>
                    </button>
                    {previousRunsOpen ? (
                      <ul className="cpd-code-index-prev-list" role="listbox" aria-label="Previous index runs">
                        {previousCodeIndexRuns.map((row) => {
                          const short = String(row.run_id).replace(/^cidxrun_/, '').slice(0, 8);
                          const sha = row.revision_sha
                            ? String(row.revision_sha).slice(0, 7)
                            : null;
                          const selected =
                            (selectedCodeIndexRunId || codeIndex.job?.run_id) === row.run_id;
                          const label = [
                            short,
                            `${Math.round(row.progress_percent || 0)}%`,
                            row.indexed_file_count ? `${row.indexed_file_count} files` : null,
                            row.chunk_count ? `${row.chunk_count} chunks` : null,
                            row.status || row.stage || null,
                            sha,
                          ]
                            .filter(Boolean)
                            .join(' · ');
                          return (
                            <li key={row.run_id} role="option" aria-selected={selected}>
                              <button
                                type="button"
                                className={
                                  selected
                                    ? 'cpd-code-index-prev-item cpd-code-index-prev-item--on'
                                    : 'cpd-code-index-prev-item'
                                }
                                title={row.last_error || row.run_id}
                                onClick={() => selectPreviousRun(row.run_id)}
                              >
                                {label}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
            {githubPickerOpen ? (
              <CodeIndexGithubPicker
                projectId={projectId}
                githubRepo={codeIndex.githubRepo}
                githubRepoSearch={githubRepoSearch}
                setGithubRepoSearch={setGithubRepoSearch}
                githubReposLoading={githubReposLoading}
                githubReposAuthed={githubReposAuthed}
                filteredGithubRepos={filteredGithubRepos}
                githubConnectBusy={githubConnectBusy}
                onClose={() => setGithubPickerOpen(false)}
                onConnect={(full, opts) => void connectProjectGithubRepo(full, opts)}
              />
            ) : null}
          </div>
        )}
      </CodeIndexRailSection>
  );
}
