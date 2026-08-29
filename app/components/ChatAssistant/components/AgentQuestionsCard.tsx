/**
 * Cursor-style batched plan questions — mobile-first (touch targets, sticky actions).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, MessageCircle } from 'lucide-react';
import type { PlanQuestionsBatchPayload } from '../types';

export type AgentQuestionsCardProps = {
  batch: PlanQuestionsBatchPayload;
  busy?: boolean;
  isNarrow?: boolean;
  onSubmit: (payload: {
    batchId: string;
    selections: Record<string, string>;
    optionalDetails: string;
    skip: boolean;
  }) => void;
};

export function AgentQuestionsCard({ batch, busy = false, isNarrow = false, onSubmit }: AgentQuestionsCardProps) {
  const questions = batch.questions || [];
  const [index, setIndex] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [otherDrafts, setOtherDrafts] = useState<Record<string, string>>({});
  const [optionalDetails, setOptionalDetails] = useState('');
  const [activeOtherId, setActiveOtherId] = useState<string | null>(null);

  const current = questions[index] ?? null;
  const total = questions.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onSubmit({ batchId: batch.batch_id, selections, optionalDetails, skip: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [batch.batch_id, selections, optionalDetails, busy, onSubmit]);

  const selectChoice = useCallback(
    (questionId: string, key: string, label: string) => {
      if (key === 'OTHER') {
        setActiveOtherId(questionId);
        return;
      }
      setActiveOtherId(null);
      setSelections((prev) => ({ ...prev, [questionId]: label }));
    },
    [],
  );

  const currentAnswer = current
    ? selections[current.id] ||
      (activeOtherId === current.id ? otherDrafts[current.id] : undefined)
    : undefined;

  const canContinue = useMemo(() => {
    if (!total) return true;
    return questions.every((q) => {
      const sel = selections[q.id];
      if (sel) return true;
      if (activeOtherId === q.id && otherDrafts[q.id]?.trim()) return true;
      return false;
    });
  }, [questions, selections, activeOtherId, otherDrafts, total]);

  const handleContinue = () => {
    const merged = { ...selections };
    for (const q of questions) {
      if (!merged[q.id] && otherDrafts[q.id]?.trim()) {
        merged[q.id] = otherDrafts[q.id].trim();
      }
    }
    onSubmit({
      batchId: batch.batch_id,
      selections: merged,
      optionalDetails: optionalDetails.trim(),
      skip: false,
    });
  };

  const pillMinH = isNarrow ? 'min-h-[44px]' : 'min-h-[36px]';

  return (
    <div
      className={`flex flex-col gap-3 min-w-0 w-full rounded-xl border border-[var(--dashboard-border)]/90 bg-[var(--scene-bg)]/90 ${
        isNarrow ? 'px-3 py-3' : 'px-3.5 py-3.5'
      }`}
    >
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessageCircle size={isNarrow ? 18 : 16} className="shrink-0 text-[var(--solar-cyan)]" />
          <span className="text-[13px] font-semibold text-[var(--dashboard-text)] truncate">Questions</span>
          {batch.phase === 'roadblock' ? (
            <span className="text-[10px] uppercase tracking-wide text-amber-300/90 shrink-0">Roadblock</span>
          ) : null}
        </div>
        {total > 1 ? (
          <div className="flex items-center gap-1 shrink-0 text-[11px] text-[var(--dashboard-muted)]">
            <button
              type="button"
              disabled={index <= 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              className="p-1 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30"
              aria-label="Previous question"
            >
              <ChevronUp size={14} />
            </button>
            <span>
              {index + 1} of {total}
            </span>
            <button
              type="button"
              disabled={index >= total - 1}
              onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
              className="p-1 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30"
              aria-label="Next question"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        ) : total === 1 ? (
          <span className="text-[11px] text-[var(--dashboard-muted)] shrink-0">1 of 1</span>
        ) : null}
      </div>

      {batch.explore_summary?.synthesis ? (
        <p className="text-[12px] leading-relaxed text-[var(--dashboard-muted)] m-0">
          {batch.explore_summary.synthesis}
        </p>
      ) : null}

      {current ? (
        <div className="flex flex-col gap-2.5 min-w-0">
          <p className={`${isNarrow ? 'text-[17px]' : 'text-[16px]'} leading-snug text-[var(--dashboard-text)] m-0`}>
            {index + 1}. {current.question}
          </p>
          <div className="flex flex-col gap-2">
            {current.choices.map((c) => {
              const selected =
                selections[current.id] === c.label ||
                (c.key === 'OTHER' && activeOtherId === current.id);
              return (
                <button
                  key={`${current.id}-${c.key}`}
                  type="button"
                  disabled={busy}
                  onClick={() => selectChoice(current.id, c.key, c.label)}
                  className={`flex items-start gap-2.5 w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${pillMinH} ${
                    selected
                      ? 'border-[var(--solar-cyan)]/50 bg-[var(--solar-cyan)]/10 text-[var(--dashboard-text)]'
                      : 'border-[var(--dashboard-border)]/80 bg-transparent text-[var(--dashboard-muted)] hover:border-[var(--solar-cyan)]/30 hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <span className="text-[11px] font-bold text-[var(--solar-cyan)] w-5 shrink-0 pt-0.5">
                    {c.key === 'OTHER' ? '…' : c.key}
                  </span>
                  <span className={`${isNarrow ? 'text-[15px]' : 'text-[13px]'} leading-snug`}>{c.label}</span>
                </button>
              );
            })}
          </div>
          {activeOtherId === current.id ? (
            <input
              type="text"
              value={otherDrafts[current.id] || ''}
              onChange={(e) =>
                setOtherDrafts((prev) => ({ ...prev, [current.id]: e.target.value }))
              }
              placeholder="Type your answer…"
              className={`w-full rounded-lg border border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-3 py-2.5 text-[var(--dashboard-text)] ${
                isNarrow ? 'text-[16px]' : 'text-[13px]'
              }`}
            />
          ) : null}
        </div>
      ) : null}

      <label className="flex flex-col gap-1.5 min-w-0">
        <span className="text-[11px] text-[var(--dashboard-muted)]">Add more optional details</span>
        <textarea
          value={optionalDetails}
          onChange={(e) => setOptionalDetails(e.target.value)}
          rows={isNarrow ? 3 : 2}
          placeholder="Constraints, scope, local-only, acceptance criteria…"
          className={`w-full resize-none rounded-lg border border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-3 py-2 text-[var(--dashboard-text)] ${
            isNarrow ? 'text-[16px] min-h-[72px]' : 'text-[12px]'
          }`}
        />
      </label>

      <div
        className={`flex items-center gap-2 pt-1 ${isNarrow ? 'sticky bottom-0 bg-[var(--scene-bg)]/95 pb-1' : ''}`}
      >
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onSubmit({ batchId: batch.batch_id, selections, optionalDetails, skip: true })
          }
          className={`px-3 py-2 rounded-lg text-[12px] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)] ${
            isNarrow ? 'min-h-[44px]' : ''
          }`}
        >
          Skip <span className="hidden sm:inline opacity-60">Esc</span>
        </button>
        <div className="flex-1" />
        <button
          type="button"
          disabled={busy || (!canContinue && total > 0)}
          onClick={handleContinue}
          className={`px-4 py-2 rounded-lg text-[12px] font-semibold bg-[var(--solar-cyan)] text-[var(--solar-base03)] hover:brightness-110 disabled:opacity-40 ${
            isNarrow ? 'min-h-[44px] text-[13px]' : ''
          }`}
        >
          {busy ? 'Continuing…' : 'Continue →'}
        </button>
      </div>
    </div>
  );
}
