/**
 * Unified Work shell header — Calendar · Tickets · Mail.
 * Mobile: top tabs hidden, replaced by fixed bottom tab strip.
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CalendarDays, CheckSquare, Mail, Menu } from 'lucide-react';
import './collaborate-work-shell.css';
import './collaborate-work-layout.css';

export type WorkSurface = 'calendar' | 'tasks' | 'mail';

/** IAM signature mark (CF Images). Black wordmark — fine on light shell chrome. */
export const WORK_SHELL_SIGNATURE_LOGO =
  'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/87aac7e9-d6c7-4a53-df89-605e8020e000/thumbnail';

type Props = {
  surface: WorkSurface;
  title?: string;
  trailing?: React.ReactNode;
  /** Second row under the topbar (calendar controls on phone). */
  mobileToolbar?: React.ReactNode;
  /** Opens Work left drawer (calendar/tickets) or mail sidebar drawer. */
  onMenuTap?: () => void;
  children?: React.ReactNode;
};

function surfaceFromPath(pathname: string, search: string): WorkSurface {
  if (pathname.includes('/mail')) return 'mail';
  const seg = new URLSearchParams(search).get('seg');
  if (seg === 'tasks' || seg === 'tickets') return 'tasks';
  return 'calendar';
}

export function useWorkSurface(): WorkSurface {
  const { pathname, search } = useLocation();
  return surfaceFromPath(pathname, search);
}

export function CollaborateWorkShell({
  surface,
  title,
  trailing,
  mobileToolbar,
  onMenuTap,
  children,
}: Props) {
  const navigate = useNavigate();

  const goCalendar = () => navigate('/dashboard/collaborate');
  const goTickets = () => navigate('/dashboard/collaborate?seg=tickets');
  const goMail = () => navigate('/dashboard/mail');

  const label =
    title ||
    (surface === 'mail' ? 'Mail' : surface === 'tasks' ? 'Tickets' : 'Calendar');

  return (
    <div className="colab-work-shell">
      <header className="colab-work-shell-topbar">
        {onMenuTap ? (
          <button
            type="button"
            className="colab-cal-hamb colab-work-shell-hamb"
            aria-label="Toggle Work navigation"
            onClick={onMenuTap}
          >
            <Menu size={18} />
          </button>
        ) : null}

        <div className="colab-work-shell-brand">
          <img
            className="colab-work-shell-logo"
            src={WORK_SHELL_SIGNATURE_LOGO}
            alt=""
            width={40}
            height={40}
            decoding="async"
          />
          <span className="colab-work-shell-product">Work</span>
          <span className="colab-work-shell-sep">/</span>
          <span className="colab-work-shell-title">{label}</span>
        </div>

        {/* Desktop surface tabs removed — Calendar / Tickets / Mail live in the left rail.
            Mobile still uses .colab-bottom-tabs below. */}
        <div className="colab-work-shell-tabs-spacer" aria-hidden />

        {trailing ? <div className="colab-work-shell-trailing">{trailing}</div> : null}
      </header>

      {mobileToolbar ? <div className="colab-cal-mobile-toolbar">{mobileToolbar}</div> : null}

      <div className="colab-work-shell-body">{children}</div>

      <nav className="colab-bottom-tabs" aria-label="Work surfaces">
        <button
          type="button"
          className={surface === 'calendar' ? 'active' : ''}
          onClick={goCalendar}
          aria-current={surface === 'calendar' ? 'page' : undefined}
        >
          <CalendarDays size={20} strokeWidth={1.75} />
          Calendar
        </button>
        <button
          type="button"
          className={surface === 'tasks' ? 'active' : ''}
          onClick={goTickets}
          aria-current={surface === 'tasks' ? 'page' : undefined}
        >
          <CheckSquare size={20} strokeWidth={1.75} />
          Tickets
        </button>
        <button
          type="button"
          className={surface === 'mail' ? 'active' : ''}
          onClick={goMail}
          aria-current={surface === 'mail' ? 'page' : undefined}
        >
          <Mail size={20} strokeWidth={1.75} />
          Mail
        </button>
      </nav>
    </div>
  );
}
