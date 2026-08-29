import React, { useCallback, useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Check, Loader2, Sparkles, SkipForward } from 'lucide-react';
import type { PlanQuestionsBatchPayload, PlanIntakeQuestion, PlanQuestionChoice } from '../../components/ChatAssistant/types';

/**
 * Full-pane "Questions" tab — presentational renderer for the same
 * `plan_questions_batch` data AgentQuestionsCard renders inline in chat.
 *
 * Submission (fetch + SSE + chat state updates) stays owned by
 * ChatAssistant's existing `handlePlanIntakeSubmit`; this component only
 * collects selections and calls `onSubmit`, exactly like AgentQuestionsCard.
 */
export type QuestionsIntakePageSubmitPayload = {
  batchId: string;
  selections: Record<string, string>;
  optionalDetails: string;
  skip: boolean;
};

export type QuestionsIntakePageProps = {
  batch: PlanQuestionsBatchPayload;
  busy?: boolean;
  isNarrow?: boolean;
  onSubmit: (payload: QuestionsIntakePageSubmitPayload) => void;
  className?: string;
};

const OTHER_KEY = 'OTHER';

type Selections = Record<string, string[]>;
type OtherText = Record<string, string>;

function choiceDisplayValue(choice: PlanQuestionChoice, otherText: string): string {
  if (choice.key !== OTHER_KEY) return choice.label;
  return otherText.trim();
}

/** Build the `selections` map AgentQuestionsCard/handlePlanIntakeSubmit expect: Record<questionId, string>. */
function buildSelectionsPayload(
  questions: PlanIntakeQuestion[],
  selections: Selections,
  otherText: OtherText,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    const chosenKeys = selections[q.id] || [];
    if (!chosenKeys.length) continue;
    const values = chosenKeys
      .map((key) => {
        const choice = q.choices.find((c) => c.key === key);
        if (!choice) return '';
        return choiceDisplayValue(choice, otherText[q.id] || '');
      })
      .filter((v) => v.trim().length > 0);
    if (!values.length) continue;
    out[q.id] = values.join(', ');
  }
  return out;
}

function PillButton({
  label,
  selected,
  multiSelect,
  onClick,
}: {
  label: string;
  selected: boolean;
  multiSelect: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.8125rem] leading-none transition-colors',
        selected
          ? 'border-[var(--solar-cyan)]/60 bg-[color-mix(in_srgb,var(--solar-cyan)_16%,transparent)] text-[var(--dashboard-text)]'
          : 'border-[var(--dashboard-border)] bg-white/[0.02] text-[var(--dashboard-muted)] hover:border-white/20 hover:text-[var(--dashboard-text)] hover:bg-white/[0.04]',
      ].join(' ')}
    >
      {multiSelect ? (
        <span
          className={[
            'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border',
            selected
              ? 'border-[var(--solar-cyan)] bg-[var(--solar-cyan)] text-[var(--solar-base03)]'
              : 'border-[var(--dashboard-muted)]/50',
          ].join(' ')}
          aria-hidden
        >
          {selected ? <Check size={10} strokeWidth={3} /> : null}
        </span>
      ) : (
        <span
          className={[
            'h-2.5 w-2.5 shrink-0 rounded-full border',
            selected ? 'border-[var(--solar-cyan)] bg-[var(--solar-cyan)]' : 'border-[var(--dashboard-muted)]/50',
          ].join(' ')}
          aria-hidden
        />
      )}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

function QuestionBlock({
  question,
  index,
  selectedKeys,
  otherText,
  onToggle,
  onOtherTextChange,
}: {
  question: PlanIntakeQuestion;
  index: number;
  selectedKeys: string[];
  otherText: string;
  onToggle: (choiceKey: string) => void;
  onOtherTextChange: (value: string) => void;
}) {
  const multiSelect = Boolean(question.multi_select);
  const otherSelected = selectedKeys.includes(OTHER_KEY);
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-[0.6875rem] font-medium text-[var(--dashboard-muted)] tabular-nums pt-0.5">
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="min-w-0">
          <p className="text-[0.9rem] font-medium leading-snug text-[var(--dashboard-text)]">{question.question}</p>
          {multiSelect ? (
            <p className="mt-0.5 text-[0.6875rem] text-[var(--dashboard-muted)]">Select all that apply</p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-[1.875rem]">
        {question.choices.map((choice) => (
          <PillButton
            key={choice.key}
            label={choice.label}
            selected={selectedKeys.includes(choice.key)}
            multiSelect={multiSelect}
            onClick={() => onToggle(choice.key)}
          />
        ))}
      </div>
      {otherSelected ? (
        <div className="pl-[1.875rem]">
          <input
            type="text"
            value={otherText}
            onChange={(e) => onOtherTextChange(e.target.value)}
            placeholder="Say more…"
            autoFocus
            className="w-full max-w-sm rounded-lg border border-[var(--dashboard-border)] bg-black/20 px-2.5 py-1.5 text-[0.8125rem] text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-muted)]/70 outline-none focus:border-[var(--solar-cyan)]/50"
          />
        </div>
      ) : null}
    </div>
  );
}

export function QuestionsIntakePage({
  batch,
  busy = false,
  isNarrow = false,
  onSubmit,
  className = '',
}: QuestionsIntakePageProps) {
  const questions = batch.questions || [];
  const [selections, setSelections] = useState<Selections>({});
  const [otherText, setOtherText] = useState<OtherText>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [optionalDetails, setOptionalDetails] = useState('');

  const toggleChoice = useCallback((qid: string, choiceKey: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = prev[qid] || [];
      if (multiSelect) {
        const next = current.includes(choiceKey)
          ? current.filter((k) => k !== choiceKey)
          : [...current, choiceKey];
        return { ...prev, [qid]: next };
      }
      const next = current.includes(choiceKey) ? [] : [choiceKey];
      return { ...prev, [qid]: next };
    });
  }, []);

  const setOther = useCallback((qid: string, value: string) => {
    setOtherText((prev) => ({ ...prev, [qid]: value }));
  }, []);

  const synthesis = batch.explore_summary?.synthesis?.trim();
  const allowSkip = batch.allow_skip !== false;

  const submit = useCallback(
    (skip: boolean) => {
      onSubmit({
        batchId: batch.batch_id,
        selections: skip ? {} : buildSelectionsPayload(questions, selections, otherText),
        optionalDetails: skip ? '' : optionalDetails.trim(),
        skip,
      });
    },
    [batch.batch_id, questions, selections, otherText, optionalDetails, onSubmit],
  );

  const continueLabel = useMemo(() => {
    const total = questions.length;
    const answered = questions.filter((q) => (selections[q.id] || []).length > 0).length;
    if (!total) return 'Continue';
    return answered > 0 ? `Continue (${answered}/${total} answered)` : 'Continue';
  }, [questions, selections]);

  if (batch.submitted) {
    return (
      <div className={`flex h-full w-full min-h-0 flex-col items-center justify-center bg-[var(--dashboard-panel)] text-[var(--dashboard-text)] ${className}`.trim()}>
        <div className="flex items-center gap-2.5 rounded-xl border border-[var(--dashboard-border)] bg-white/[0.02] px-4 py-3">
          <Sparkles size={16} className="text-[var(--solar-cyan)]" aria-hidden />
          <p className="text-[0.8125rem] text-[var(--dashboard-text)]/90">Answered — see chat for the plan.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full w-full min-h-0 flex-col bg-[var(--dashboard-panel)] text-[var(--dashboard-text)] ${className}`.trim()}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--dashboard-border)] px-4">
        <Sparkles size={14} className="text-[var(--solar-cyan)]" aria-hidden />
        <span className="text-[0.75rem] font-medium uppercase tracking-wide text-[var(--dashboard-muted)]">
          Agent Sam · Questions
        </span>
        {batch.phase === 'roadblock' ? (
          <span className="inline-flex items-center rounded-md border border-amber-400/28 bg-amber-500/12 px-1.5 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide text-amber-200">
            Roadblock
          </span>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className={`mx-auto w-full max-w-2xl ${isNarrow ? 'px-3 py-4' : 'px-5 py-6'} space-y-6`}>
          {synthesis ? (
            <div className="rounded-xl border border-[var(--dashboard-border)] bg-white/[0.02] px-3.5 py-3">
              <p className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--dashboard-muted)]">
                What I found
              </p>
              <p className="text-[0.8125rem] leading-relaxed text-[var(--dashboard-text)]/90">{synthesis}</p>
            </div>
          ) : null}

          <div className="space-y-5">
            {questions.map((q, i) => (
              <QuestionBlock
                key={q.id}
                question={q}
                index={i}
                selectedKeys={selections[q.id] || []}
                otherText={otherText[q.id] || ''}
                onToggle={(choiceKey) => toggleChoice(q.id, choiceKey, Boolean(q.multi_select))}
                onOtherTextChange={(value) => setOther(q.id, value)}
              />
            ))}
          </div>

          <div>
            <button
              type="button"
              onClick={() => setDetailsOpen((o) => !o)}
              className="inline-flex items-center gap-1 text-[0.75rem] font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
            >
              {detailsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Anything else?
            </button>
            {detailsOpen ? (
              <textarea
                value={optionalDetails}
                onChange={(e) => setOptionalDetails(e.target.value)}
                placeholder="Add any extra context…"
                rows={3}
                className="mt-2 w-full resize-none rounded-lg border border-[var(--dashboard-border)] bg-black/20 px-2.5 py-2 text-[0.8125rem] text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-muted)]/70 outline-none focus:border-[var(--solar-cyan)]/50"
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--dashboard-border)] bg-[color-mix(in_srgb,var(--dashboard-panel)_85%,transparent)] px-4 py-3 backdrop-blur-xl">
        {allowSkip ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => submit(true)}
            className="inline-flex items-center gap-1.5 min-h-[2rem] px-2.5 rounded-lg text-[0.75rem] font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] hover:bg-white/[0.04] disabled:opacity-45 transition-colors"
          >
            <SkipForward size={13} aria-hidden />
            Skip
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => submit(false)}
          className="inline-flex items-center justify-center gap-1.5 min-h-[2.25rem] px-4 rounded-lg text-[0.8125rem] font-semibold text-[var(--solar-base03)] bg-[var(--solar-cyan)] shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_4px_14px_rgba(34,211,238,0.22)] hover:brightness-110 disabled:opacity-45 transition-all"
        >
          {busy ? (
            <>
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Continuing…
            </>
          ) : (
            <>
              {continueLabel}
              <ChevronRight size={14} aria-hidden />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/** Visual-testing fixture — matches PlanQuestionsBatchPayload (components/ChatAssistant/types.ts). */
export const MOCK_PLAN_QUESTIONS_BATCH: PlanQuestionsBatchPayload = {
  batch_id: 'mock-batch-1',
  phase: 'pre_plan',
  plan_id: null,
  explore_summary: {
    synthesis:
      'The Companions of CPAS /services page already has a Foster card and a real dog dataset. Adding "Adopt" and "Volunteer" cards would follow the same pattern.',
  },
  allow_skip: true,
  questions: [
    {
      id: 'q1',
      question: 'Which service cards should be added to the /services page?',
      multi_select: true,
      choices: [
        { key: 'A', label: 'Adopt' },
        { key: 'B', label: 'Volunteer' },
        { key: 'C', label: 'Donate' },
        { key: 'D', label: 'Sponsor a dog' },
        { key: 'E', label: 'Events' },
        { key: OTHER_KEY, label: 'Other…' },
      ],
    },
    {
      id: 'q2',
      question: 'Should the new cards use real data from D1, or static placeholder content for now?',
      multi_select: false,
      choices: [
        { key: 'A', label: 'Real D1 data' },
        { key: 'B', label: 'Static placeholder' },
        { key: OTHER_KEY, label: 'Other…' },
      ],
    },
    {
      id: 'q3',
      question: 'Any specific dogs, events, or sponsors to feature first?',
      multi_select: false,
      choices: [
        { key: 'A', label: 'No, use whatever is in D1' },
        { key: 'B', label: 'Yes — let me specify' },
        { key: OTHER_KEY, label: 'Other…' },
      ],
    },
  ],
};
