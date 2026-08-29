import React from 'react';
import { Paperclip, Plus, Send, X } from 'lucide-react';
import { AgentComposerSourceChips } from '../../../components/ChatAssistant/composer/AgentComposerSourceChips';
import type { UseProjectComposerBridgeParams } from './useProjectComposerBridge';
import { useProjectComposerBridge } from './useProjectComposerBridge';

/**
 * B3 peel — mechanical move only, no behavior change.
 * Extracted from ProjectDetailPage.tsx (composer JSX + attach <input>).
 * Wraps useProjectComposerBridge; host renders <ProjectComposerPanel {...params} />
 * in place of the old inline composer block.
 */
export function ProjectComposerPanel(params: UseProjectComposerBridgeParams) {
  const {
    draft,
    setDraft,
    composerAttachments,
    setComposerAttachments,
    textareaRef,
    composerAttachRef,
    composerRef,
    attachButtonRef,
    composerSources,
    attachMenuOpen,
    toggleAttachMenu,
    removeComposerSource,
    renderAttachMenuPortal,
    sendProjectChat,
    onComposerFiles,
  } = useProjectComposerBridge(params);

  return (
    <>
      <div className="cpd-composer" ref={composerRef}>
        <AgentComposerSourceChips
          sources={composerSources}
          onRemove={removeComposerSource}
          className="cpd-composer-source-chips"
        />
        {composerAttachments.length > 0 ? (
          <div className="cpd-composer-attachments">
            {composerAttachments.map((f, i) => (
              <span key={`${f.name}-${i}`} className="cpd-composer-attach-chip">
                <Paperclip size={11} aria-hidden />
                <span className="cpd-composer-attach-name">{f.name}</span>
                <button
                  type="button"
                  className="cpd-composer-attach-remove"
                  aria-label={`Remove ${f.name}`}
                  onClick={() =>
                    setComposerAttachments((prev) => prev.filter((_, idx) => idx !== i))
                  }
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          className="cpd-composer-input"
          placeholder="How can I help you today?"
          value={draft}
          rows={1}
          disabled={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendProjectChat();
            }
          }}
        />
        <div className="cpd-composer-footer">
          <button
            type="button"
            ref={attachButtonRef}
            className="cpd-composer-new"
            title="Add files, tools, or connections"
            aria-expanded={attachMenuOpen}
            onClick={toggleAttachMenu}
          >
            <Plus size={14} />
          </button>
          <div className="cpd-composer-spacer" />
          <button
            type="button"
            className="cpd-composer-send"
            onClick={() => sendProjectChat()}
            disabled={!draft.trim() && composerAttachments.length === 0}
            aria-label="Send"
          >
            <Send size={14} />
          </button>
        </div>
      </div>

      {renderAttachMenuPortal()}
      <input
        ref={composerAttachRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.txt,.md,.csv,.json"
        hidden
        onChange={(e) => {
          onComposerFiles(e.target.files);
          if (composerAttachRef.current) composerAttachRef.current.value = '';
        }}
      />
    </>
  );
}
