/** @license SPDX-License-Identifier: Apache-2.0 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentWorkspaceContextPacket } from '../../../../app/dashboard/src/ideWorkspace.ts';
import { BrowserPane, type BrowserPreviewPayload } from './BrowserPane.tsx';
import { mintBrowserSessionLease } from './browserApi.ts';

export type BrowserWorkbenchProps = {
  url?: string;
  addressDisplay?: string | null;
  onUrlCommitted?: (url: string) => void;
  agentRunId?: string | null;
  workspaceContext?: AgentWorkspaceContextPacket | null;
  previewSource?: 'editor' | 'agent';
};

export function BrowserWorkbench({
  url: urlFromParent,
  addressDisplay,
  onUrlCommitted,
  agentRunId = null,
  workspaceContext = null,
  previewSource = 'agent',
}: BrowserWorkbenchProps) {
  const workspaceId =
    workspaceContext?.workspace_id?.trim() ||
    (typeof window !== 'undefined'
      ? String((window as unknown as { __IAM_WORKSPACE_ID__?: string }).__IAM_WORKSPACE_ID__ || '').trim()
      : '') ||
    null;

  const [primaryBrowserSessionId, setPrimaryBrowserSessionId] = useState<string | null>(null);
  const [secondaryBrowserSessionId, setSecondaryBrowserSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (previewSource === 'editor') return;
    let cancelled = false;
    void mintBrowserSessionLease(workspaceId).then((out) => {
      if (!cancelled && out.browser_session_id) setPrimaryBrowserSessionId(out.browser_session_id);
    });
    return () => {
      cancelled = true;
    };
  }, [previewSource, workspaceId]);

  const [primaryUrl,         setPrimaryUrl]         = useState(() => urlFromParent?.trim() || '');
  const [primaryAutomation, setPrimaryAutomation] = useState(false);
  const [primaryAgentLive,  setPrimaryAgentLive]  = useState(() => previewSource !== 'editor');
  const [primaryPreview,    setPrimaryPreview]    = useState<BrowserPreviewPayload | null>(null);
  const urlFromParentRef = useRef(urlFromParent);

  const commitUrlToParent = useCallback(
    (url: string) => {
      setPrimaryAutomation(false);
      setPrimaryPreview(null);
      onUrlCommitted?.(url);
    },
    [onUrlCommitted],
  );

  useEffect(() => {
    const u = urlFromParent?.trim();
    if (!u) return;
    urlFromParentRef.current = urlFromParent;
    if (u === primaryUrl) return;
    setPrimaryUrl(u);
    if (previewSource === 'editor') {
      setPrimaryAutomation(false);
      setPrimaryAgentLive(false);
      setPrimaryPreview(null);
    }
  }, [urlFromParent, primaryUrl, previewSource]);

  const [secondaryUrl, setSecondaryUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!secondaryUrl || secondaryBrowserSessionId) return;
    let cancelled = false;
    void mintBrowserSessionLease(workspaceId).then((out) => {
      if (!cancelled && out.browser_session_id) setSecondaryBrowserSessionId(out.browser_session_id);
    });
    return () => {
      cancelled = true;
    };
  }, [secondaryUrl, secondaryBrowserSessionId, workspaceId]);

  useEffect(() => {
    const onAgentOpenSurface = (e: Event) => {
      const d = (e as CustomEvent<{ surface?: string; agent_live?: boolean; url?: string }>).detail;
      if (String(d?.surface || '').toLowerCase() !== 'browser') return;
      if (d?.agent_live) setPrimaryAgentLive(true);
      if (d?.url?.trim()) setPrimaryUrl(d.url.trim());
    };
    const onPrimary = (e: Event) => {
      const d = (e as CustomEvent<{
        url?: string;
        screenshot_url?: string;
        automation?: boolean;
        agent_live?: boolean;
        live_view_url?: string;
        session_id?: string;
        browser_session_id?: string;
      }>).detail;
      if (d?.url) {
        setPrimaryUrl(d.url);
        const hasLive = Boolean(d.live_view_url?.trim());
        const agentLivePreferred =
          hasLive ||
          d.agent_live === true ||
          d.automation === true ||
          Boolean(primaryBrowserSessionId?.trim());
        setPrimaryAutomation(d.automation === true && !agentLivePreferred);
        setPrimaryAgentLive(agentLivePreferred && !d.screenshot_url);
        if (d.screenshot_url) {
          setPrimaryPreview({ screenshot_url: d.screenshot_url });
        } else {
          setPrimaryPreview(null);
        }
        if (agentLivePreferred) {
          window.dispatchEvent(
            new CustomEvent('iam-browser-agent-live', {
              detail: {
                url: d.url,
                live_view_url: d.live_view_url,
                session_id: d.session_id,
                browser_session_id: d.browser_session_id ?? primaryBrowserSessionId ?? undefined,
                agent_run_id: agentRunId || undefined,
              },
            }),
          );
        }
      }
    };
    const onSecondary = (e: Event) => {
      const url = (e as CustomEvent<{ url?: string }>).detail?.url;
      if (url) setSecondaryUrl(url);
    };
    window.addEventListener('iam:agent-open-surface', onAgentOpenSurface as EventListener);
    window.addEventListener('iam-browser-navigate', onPrimary);
    window.addEventListener('iam-browser-navigate-secondary', onSecondary);
    return () => {
      window.removeEventListener('iam:agent-open-surface', onAgentOpenSurface as EventListener);
      window.removeEventListener('iam-browser-navigate', onPrimary);
      window.removeEventListener('iam-browser-navigate-secondary', onSecondary);
    };
  }, [agentRunId, primaryBrowserSessionId]);

  return (
    <div className="flex w-full h-full overflow-hidden bg-[var(--bg-app)] flex-col">
      <div className="flex w-full min-h-0 flex-1 overflow-hidden">
        <div
          className={`flex flex-col min-h-0 min-w-0 overflow-hidden transition-all duration-200 ${
            secondaryUrl ? 'w-1/2 border-r border-[var(--border-subtle)]' : 'w-full'
          }`}
        >
          <BrowserPane
            initialUrl={primaryUrl}
            initialPreview={primaryPreview}
            initialAutomation={primaryAutomation}
            initialAgentLive={primaryAgentLive}
            previewSource={previewSource}
            addressDisplay={addressDisplay}
            label={secondaryUrl ? 'A' : undefined}
            isSplit={!!secondaryUrl}
            onSplit={(url) => setSecondaryUrl(url)}
            onUrlCommitted={commitUrlToParent}
            browserSessionId={previewSource === 'editor' ? null : primaryBrowserSessionId}
            agentRunId={previewSource === 'editor' ? null : agentRunId}
            autoFocus
          />
        </div>
        {secondaryUrl && (
          <div className="flex flex-col w-1/2 min-h-0 min-w-0 overflow-hidden">
            <BrowserPane
              initialUrl={secondaryUrl}
              label="B"
              isSplit
              onClose={() => setSecondaryUrl(null)}
              autoFocus
              browserSessionId={secondaryBrowserSessionId}
              agentRunId={agentRunId}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default BrowserWorkbench;
