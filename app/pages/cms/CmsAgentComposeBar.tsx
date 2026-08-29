import React, { useCallback, useState } from 'react';
import { ArrowUp, Sparkles } from 'lucide-react';
import { IAM_AGENT_CHAT_COMPOSE } from '../../agentChatConstants';

type Props = {
  siteSlug: string;
  siteName?: string | null;
  placeholder?: string;
};

export function CmsAgentComposeBar({
  siteSlug,
  siteName,
  placeholder,
}: Props) {
  const [draft, setDraft] = useState('');

  const dispatchCompose = useCallback(
    (message: string, send: boolean) => {
      window.dispatchEvent(
        new CustomEvent(IAM_AGENT_CHAT_COMPOSE, {
          detail: {
            message,
            send,
            ensureAgentPanel: true,
            project_slug: siteSlug,
            surface: 'cms',
          },
        }),
      );
    },
    [siteSlug],
  );

  const onSubmit = useCallback(() => {
    const message = draft.trim();
    if (!message) {
      dispatchCompose('', false);
      return;
    }
    dispatchCompose(message, true);
    setDraft('');
  }, [draft, dispatchCompose]);

  return (
    <section className="iam-cms-compose" aria-label="Ask Agent Sam about this site">
      <div className="iam-cms-compose__inner">
        <Sparkles size={16} strokeWidth={1.75} aria-hidden className="text-[#0d9488] shrink-0" />
        <input
          className="iam-cms-compose__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            placeholder ||
            `What would you like to manage on ${siteName || siteSlug} today?`
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <button
          type="button"
          className="iam-cms-compose__send"
          aria-label="Send to Agent Sam"
          disabled={!draft.trim()}
          onClick={onSubmit}
        >
          <ArrowUp size={16} strokeWidth={2.2} aria-hidden />
        </button>
      </div>
    </section>
  );
}
