import { useNavigate } from 'react-router-dom';
import { BookOpen, Bot, CalendarCog, CheckSquare, Lightbulb, ListTodo, Mail, Video } from 'lucide-react';
import type { CollaborateCalendarRightPanel } from '../../lib/collaborate/collaborateRailNav';

type ActiveSurface = 'calendar' | 'tasks' | 'mail';

type Props = {
  onTasksClick: () => void;
  insightsOpen?: boolean;
  onInsightsToggle?: () => void;
  rightPanel?: CollaborateCalendarRightPanel | null;
  onCalendarSetupToggle?: () => void;
  onActiveTasksToggle?: () => void;
  activeTasksCount?: number;
  showCalendarPanels?: boolean;
  /** Highlights the current work surface on the rail (e.g. mail when on /dashboard/mail). */
  activeSurface?: ActiveSurface;
  /** Mail-only: open Agent Sam side rail with inbox context. */
  onMailAgentClick?: () => void;
  mailAgentActive?: boolean;
};

/** Right rail on /dashboard/collaborate — Lucide icons. */
export function CollaboratePageRail({
  onTasksClick,
  insightsOpen = false,
  onInsightsToggle,
  rightPanel = null,
  onCalendarSetupToggle,
  onActiveTasksToggle,
  activeTasksCount = 0,
  showCalendarPanels = false,
  activeSurface,
  onMailAgentClick,
  mailAgentActive = false,
}: Props) {
  const navigate = useNavigate();
  const insightsActive = rightPanel ? rightPanel === 'insights' : insightsOpen;
  const setupActive = rightPanel === 'calendar-setup';
  const activeTasksActive = rightPanel === 'active-tasks';

  return (
    <aside className="colab-cal-rail" aria-label="Collaborate apps">
      <button
        type="button"
        className={`colab-cal-rail-icon yellow${insightsActive ? ' active' : ''}`}
        title="Insights"
        aria-label="Insights"
        aria-pressed={insightsActive}
        onClick={() => onInsightsToggle?.()}
      >
        <Lightbulb size={20} strokeWidth={1.75} />
      </button>
      {showCalendarPanels ? (
        <>
          <button
            type="button"
            className={`colab-cal-rail-icon teal${activeTasksActive ? ' active' : ''}`}
            title="Active tasks"
            aria-label={`Active tasks${activeTasksCount ? `, ${activeTasksCount} open` : ''}`}
            aria-pressed={activeTasksActive}
            onClick={() => onActiveTasksToggle?.()}
          >
            <ListTodo size={20} strokeWidth={1.75} />
            {activeTasksCount > 0 ? <span className="colab-cal-rail-badge">{activeTasksCount > 99 ? '99+' : activeTasksCount}</span> : null}
          </button>
          <button
            type="button"
            className={`colab-cal-rail-icon slate${setupActive ? ' active' : ''}`}
            title="Calendar setup"
            aria-label="Calendar setup and booking"
            aria-pressed={setupActive}
            onClick={() => onCalendarSetupToggle?.()}
          >
            <CalendarCog size={20} strokeWidth={1.75} />
          </button>
        </>
      ) : null}
      <button
        type="button"
        className={`colab-cal-rail-icon blue${activeSurface === 'tasks' ? ' active' : ''}`}
        title="Tickets"
        aria-label="Tickets"
        aria-current={activeSurface === 'tasks' ? 'page' : undefined}
        onClick={onTasksClick}
      >
        <CheckSquare size={20} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className="colab-cal-rail-icon green"
        title="Meet"
        aria-label="Meet"
        onClick={() => navigate('/dashboard/meet')}
      >
        <Video size={20} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className={`colab-cal-rail-icon orange${activeSurface === 'mail' ? ' active' : ''}`}
        title="Mail"
        aria-label="Mail"
        aria-current={activeSurface === 'mail' ? 'page' : undefined}
        onClick={() => navigate('/dashboard/mail')}
      >
        <Mail size={20} strokeWidth={1.75} />
      </button>
      {activeSurface === 'mail' && onMailAgentClick ? (
        <button
          type="button"
          className={`colab-cal-rail-icon violet${mailAgentActive ? ' active' : ''}`}
          title="Mail assistant"
          aria-label="Open Agent Sam mail assistant"
          aria-pressed={mailAgentActive}
          onClick={() => onMailAgentClick()}
        >
          <Bot size={20} strokeWidth={1.75} />
        </button>
      ) : null}
      <button
        type="button"
        className="colab-cal-rail-icon"
        title="Learn"
        aria-label="Learn"
        onClick={() => navigate('/dashboard/learn')}
      >
        <BookOpen size={20} strokeWidth={1.75} />
      </button>
    </aside>
  );
}
