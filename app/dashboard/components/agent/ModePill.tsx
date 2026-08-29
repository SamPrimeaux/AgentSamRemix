import type { ComponentType } from 'react';
import { Code2, PenLine, Sparkles, GraduationCap, Coffee } from 'lucide-react';
import type { AgentModePill, AgentModeId } from '../../types/agentHomeScene';

const ICONS: Record<AgentModeId, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  code: Code2,
  write: PenLine,
  create: Sparkles,
  learn: GraduationCap,
  life: Coffee,
};

export function ModePill({
  pill,
  onSelect,
}: {
  pill: AgentModePill;
  onSelect: (mode: AgentModeId) => void;
}) {
  const Icon = ICONS[pill.id];
  return (
    <button
      type="button"
      className="agent-pill"
      onClick={() => onSelect(pill.id)}
    >
      <Icon size={15} strokeWidth={1.5} />
      <span>{pill.label}</span>
    </button>
  );
}
