import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  CheckSquare,
  FolderKanban,
  Layers,
  Mail,
} from 'lucide-react';

export type CollaborateLeftNavKey = 'calendar' | 'tickets' | 'mail' | 'projects' | 'files';

type Props = {
  active: CollaborateLeftNavKey;
  onCreate?: () => void;
  onOpenTickets?: () => void;
  /** Close mobile drawer after a surface navigation. */
  onNavigate?: () => void;
};

const NAV: { key: CollaborateLeftNavKey; label: string; icon: typeof CalendarDays }[] = [
  { key: 'calendar', label: 'Calendar', icon: CalendarDays },
  { key: 'tickets', label: 'Tickets', icon: CheckSquare },
  { key: 'mail', label: 'Mail', icon: Mail },
  { key: 'projects', label: 'Projects', icon: FolderKanban },
  { key: 'files', label: 'Work files', icon: Layers },
];

/** Drive-style left rail for Collaborate Work surfaces. */
export function CollaborateCalendarLeftNav({
  active,
  onCreate,
  onOpenTickets,
  onNavigate,
}: Props) {
  const navigate = useNavigate();

  const go = (key: CollaborateLeftNavKey) => {
    if (key === 'calendar') {
      navigate('/dashboard/collaborate');
      onNavigate?.();
      return;
    }
    if (key === 'tickets') {
      if (onOpenTickets) onOpenTickets();
      else navigate('/dashboard/collaborate?seg=tickets');
      onNavigate?.();
      return;
    }
    if (key === 'mail') {
      navigate('/dashboard/mail');
      onNavigate?.();
      return;
    }
    if (key === 'projects') {
      navigate('/dashboard/projects');
      onNavigate?.();
      return;
    }
    navigate('/dashboard/artifacts');
    onNavigate?.();
  };

  return (
    <div className="colab-left-nav">
      {onCreate ? (
        <button type="button" className="colab-cal-create-btn" onClick={onCreate}>
          <span className="colab-cal-create-plus">+</span>
          <span>Create</span>
        </button>
      ) : null}

      <nav className="colab-left-nav-list" aria-label="Work surfaces">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              className={`colab-left-nav-item${active === item.key ? ' active' : ''}`}
              onClick={() => go(item.key)}
            >
              <span className="colab-left-nav-icon" aria-hidden>
                <Icon size={18} strokeWidth={1.75} />
              </span>
              <span className="colab-left-nav-label">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
