import { AGENT_MODE_PILLS, type AgentModeId } from '../../types/agentHomeScene';
import { greetingForDayPart } from '../../lib/agentDayPart';
import type { AgentDayPart } from '../../lib/agentDayPart';
import { ModePill } from './ModePill';
import './AgentHomeHero.css';

interface AgentHomeHeroProps {
  name: string;
  dayPart: AgentDayPart;
  onModeSelect: (mode: AgentModeId) => void;
}

export function AgentHomeHero({ name, dayPart, onModeSelect }: AgentHomeHeroProps) {
  const greeting = greetingForDayPart(dayPart, name);

  return (
    <div className="agent-hero">
      <div className="agent-hero__greeting-row">
        <MarkGlyph dayPart={dayPart} />
        <h1 className="agent-hero__greeting">{greeting}</h1>
      </div>

      <div className="agent-hero__pills" role="group" aria-label="Quick modes">
        {AGENT_MODE_PILLS.map((pill) => (
          <ModePill key={pill.id} pill={pill} onSelect={onModeSelect} />
        ))}
      </div>
    </div>
  );
}

function MarkGlyph({ dayPart }: { dayPart: AgentDayPart }) {
  const isNight = dayPart === 'late-night' || dayPart === 'evening';
  return (
    <svg
      className="agent-hero__mark"
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      aria-hidden="true"
    >
      {isNight ? (
        <>
          <g stroke="var(--agent-accent)" strokeWidth="1.1" strokeLinecap="round">
            <line x1="11" y1="1" x2="11" y2="6" />
            <line x1="11" y1="16" x2="11" y2="21" />
            <line x1="1" y1="11" x2="6" y2="11" />
            <line x1="16" y1="11" x2="21" y2="11" />
            <line x1="4.2" y1="4.2" x2="7.6" y2="7.6" />
            <line x1="14.4" y1="14.4" x2="17.8" y2="17.8" />
            <line x1="17.8" y1="4.2" x2="14.4" y2="7.6" />
            <line x1="7.6" y1="14.4" x2="4.2" y2="17.8" />
          </g>
          <circle cx="11" cy="11" r="3.4" fill="var(--agent-accent)" opacity="0.85" />
        </>
      ) : (
        <>
          <circle cx="11" cy="11" r="4.2" fill="var(--agent-accent)" opacity="0.9" />
          <g stroke="var(--agent-accent-soft)" strokeWidth="0.9" strokeLinecap="round" opacity="0.7">
            <line x1="11" y1="2" x2="11" y2="5" />
            <line x1="11" y1="17" x2="11" y2="20" />
            <line x1="2" y1="11" x2="5" y2="11" />
            <line x1="17" y1="11" x2="20" y2="11" />
          </g>
        </>
      )}
    </svg>
  );
}
