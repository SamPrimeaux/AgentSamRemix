import React, { useCallback, useState } from 'react';
import { ArrowUp, Mic, Paperclip, Sparkles } from 'lucide-react';
import { IAM_AGENT_CHAT_NEW_THREAD, IAM_AGENT_ENSURE_PANEL } from '../../agentChatConstants';

type Props = {
  siteSlug?: string | null;
  siteName?: string | null;
};

export function CmsGuidedChatHero({ siteSlug, siteName }: Props) {
  const [draft, setDraft] = useState('');

  const placeholder = siteSlug
    ? `What would you like to manage on ${siteName || siteSlug} today?`
    : 'What would you like to manage in your CMS today?';

  const openAgentRail = useCallback(() => {
    window.dispatchEvent(new CustomEvent(IAM_AGENT_ENSURE_PANEL));
  }, []);

  const sendToAgent = useCallback(
    (message: string) => {
      openAgentRail();
      window.dispatchEvent(
        new CustomEvent(IAM_AGENT_CHAT_NEW_THREAD, {
          detail: {
            message,
            ensureAgentPanel: false,
            project_slug: siteSlug || undefined,
            surface: 'cms',
          },
        }),
      );
    },
    [openAgentRail, siteSlug],
  );

  const onSubmit = useCallback(() => {
    const message = draft.trim();
    if (!message) {
      openAgentRail();
      return;
    }
    sendToAgent(message);
    setDraft('');
  }, [draft, openAgentRail, sendToAgent]);

  return (
    <section className="iam-cms-guided-hero" aria-label="CMS guided chat">
      <div className="iam-cms-guided-hero__copy">
        <p className="iam-cms-guided-hero__kicker">AgentSam · CMS</p>
        <h1 className="iam-cms-guided-hero__title">One goal. Infinite possibilities.</h1>
        <p className="iam-cms-guided-hero__sub">Describe your goal. AgentSam handles the rest.</p>
      </div>

      <div className="iam-cms-guided-hero__compose">
        <div className="iam-cms-guided-hero__compose-meta">
          <span className="iam-cms-guided-hero__agent-pill">
            <Sparkles size={13} strokeWidth={1.75} aria-hidden />
            Agent Sam
          </span>
          <span className="iam-cms-guided-hero__mode-pill">Auto</span>
        </div>
        <div className="iam-cms-guided-hero__compose-row">
          <input
            className="iam-cms-guided-hero__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            onFocus={openAgentRail}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
          <div className="iam-cms-guided-hero__tools">
            <button type="button" className="iam-cms-guided-hero__icon-btn" aria-label="Voice input" disabled>
              <Mic size={16} strokeWidth={1.75} aria-hidden />
            </button>
            <button type="button" className="iam-cms-guided-hero__icon-btn" aria-label="Attach" disabled>
              <Paperclip size={16} strokeWidth={1.75} aria-hidden />
            </button>
            <button
              type="button"
              className="iam-cms-guided-hero__send"
              aria-label="Send to Agent Sam"
              disabled={!draft.trim()}
              onClick={onSubmit}
            >
              <ArrowUp size={16} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
