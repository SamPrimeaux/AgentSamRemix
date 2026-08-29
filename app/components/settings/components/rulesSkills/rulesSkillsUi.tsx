import React from 'react';
import { FileText, Sparkles, Users, Terminal } from 'lucide-react';

export function RulesSkillsIntro({ tab }: { tab: 'skills' | 'subagents' | 'commands' | 'rules' }) {
  const copy = {
    rules: {
      title: 'Rules',
      body: 'Provide domain-specific guidance and guardrails for Agent Sam. Rules apply by scope: always, by file path (glob), or only when you invoke them manually.',
      icon: FileText,
    },
    skills: {
      title: 'Skills',
      body: 'Specialized capabilities and workflows the agent can load when relevant — or trigger with a slash command in chat.',
      icon: Sparkles,
    },
    subagents: {
      title: 'Subagents',
      body: 'Focused agent profiles for complex tasks — each with its own instructions, model, and sandbox posture.',
      icon: Users,
    },
    commands: {
      title: 'Commands',
      body: 'Slash commands and automation hooks registered for this workspace. Toggle which commands are active.',
      icon: Terminal,
    },
  }[tab];
  const Icon = copy.icon;
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)]/80 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] flex items-center justify-center shrink-0 text-[var(--solar-cyan)]">
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-[var(--text-heading)]">{copy.title}</div>
          <p className="text-[11px] text-muted leading-relaxed mt-1">{copy.body}</p>
        </div>
      </div>
    </div>
  );
}

export function ApplyModeBadge({ mode, globs }: { mode?: string; globs?: string | null }) {
  const m = String(mode || 'always').toLowerCase();
  const label = m === 'glob' ? 'Glob' : m === 'manual' ? 'Manual' : 'Always';
  const tone =
    m === 'glob'
      ? 'text-amber-200/90 border-amber-500/30 bg-amber-500/10'
      : m === 'manual'
        ? 'text-violet-200/90 border-violet-500/30 bg-violet-500/10'
        : 'text-[var(--solar-cyan)] border-[var(--solar-cyan)]/30 bg-[var(--solar-cyan)]/10';
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1">
      <span className={`text-[9px] px-2 py-0.5 rounded-full border font-semibold uppercase tracking-wide ${tone}`}>
        {label}
      </span>
      {m === 'glob' && globs ? (
        <span className="text-[9px] px-2 py-0.5 rounded bg-[var(--bg-app)] border border-[var(--border-subtle)] text-muted font-mono truncate max-w-[220px]">
          {globs}
        </span>
      ) : null}
    </div>
  );
}

export function RulesSkillsEmpty({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-app)]/50 px-6 py-10 text-center">
      <p className="text-[12px] text-muted">{message}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
