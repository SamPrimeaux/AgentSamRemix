import React from 'react';
import {
  closeBrowserLiveView,
  fetchBrowserLiveView,
  type BrowserLiveView,
} from './browserApi';

export interface BrowserPaneProps {
  /** Exact Think Agent name owning the conversation/browser session. */
  agentName?: string | null;
}

export const BrowserPane: React.FC<BrowserPaneProps> = ({ agentName = null }) => {
  const [state, setState] = React.useState<BrowserLiveView | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    try {
      setState(await fetchBrowserLiveView(agentName));
    } catch (error) {
      setState({
        ok: false,
        active: false,
        error: error instanceof Error ? error.message : 'browser_live_view_failed',
      });
    } finally {
      setLoading(false);
    }
  }, [agentName]);

  React.useEffect(() => {
    setLoading(true);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const close = React.useCallback(async () => {
    await closeBrowserLiveView(agentName).catch(() => undefined);
    await refresh();
  }, [agentName, refresh]);

  const target = state?.targets?.find((item) => item.type === 'page') || state?.targets?.[0];

  if (target?.url) {
    return (
      <div className="as-live-browser">
        <div className="as-live-browser-bar">
          <span className="as-live-dot" />
          <span className="as-live-url">{target.pageUrl || target.title || 'Browser Run'}</span>
          <button type="button" onClick={() => void refresh()}>Refresh</button>
          <button type="button" onClick={() => void close()}>Close session</button>
        </div>
        <iframe
          title="Agent Sam Browser Run Live View"
          src={target.url}
          allow="clipboard-read; clipboard-write"
        />
      </div>
    );
  }

  const sessionMissing = state?.error === 'session_required';
  const browserTitle = loading
    ? 'Checking Browser Run…'
    : sessionMissing
      ? 'Sign in to use Browser Run'
      : 'No active browser session';
  const browserCopy = sessionMissing
    ? 'Your browser session is not currently authenticated. Re-authenticate Agent Sam, then Browser Run will reuse the same Think-agent session.'
    : 'Ask Agent Sam to navigate or inspect a site. The reusable Browser Run session will appear here automatically as an interactive Live View.';

  return (
    <div className="as-browser-agent">
      <div className="as-browser-icon">◎</div>
      <h2>{browserTitle}</h2>
      <p>{browserCopy}</p>
      <p className="as-browser-note">
        WebMCP first when available, then CDP/DOM. Browser state belongs to the same Think Agent that owns the conversation.
      </p>
      {state?.error && !sessionMissing && (
        <p className="as-browser-error">Browser unavailable right now. Try again or inspect runtime status.</p>
      )}
      <button className="as-browser-refresh" type="button" onClick={() => void refresh()}>
        {sessionMissing ? 'Retry session' : 'Check now'}
      </button>
    </div>
  );
};

export default BrowserPane;
