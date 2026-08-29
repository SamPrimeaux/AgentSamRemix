import type { BookingPage } from './ops-desk-types';

type Sources = {
  primary: boolean;
  tasks: boolean;
  holidays: boolean;
  birthdays: boolean;
  google_calendar: boolean;
};

type GcalStatus = {
  connected?: boolean;
  accounts?: Array<{
    account?: string;
    needs_reconnect?: boolean;
    event_count?: number;
  }>;
} | null;

type Props = {
  workingHoursForm: { timezone: string; start: string; end: string };
  onWorkingHoursChange: (next: { timezone: string; start: string; end: string }) => void;
  hoursSaving: boolean;
  onSaveWorkingHours: () => void | Promise<void>;
  bookingDraft: { title: string; slug: string; duration_min: number };
  onBookingDraftChange: (next: { title: string; slug: string; duration_min: number }) => void;
  bookingSaving: boolean;
  onCreateBookingPage: () => void | Promise<void>;
  bookingPages: BookingPage[];
  onCopyBookingLink: (slug: string) => void;
  onDeactivateBookingPage: (page: BookingPage) => void | Promise<void>;
  sources: Sources;
  onSourcesChange: (updater: (prev: Sources) => Sources) => void;
  gcalStatus: GcalStatus;
  gcalSyncing: boolean;
  onSyncGoogleCalendar: () => void | Promise<void>;
  onClose: () => void;
};

export function CollaborateCalendarSetupPanel({
  workingHoursForm,
  onWorkingHoursChange,
  hoursSaving,
  onSaveWorkingHours,
  bookingDraft,
  onBookingDraftChange,
  bookingSaving,
  onCreateBookingPage,
  bookingPages,
  onCopyBookingLink,
  onDeactivateBookingPage,
  sources,
  onSourcesChange,
  gcalStatus,
  gcalSyncing,
  onSyncGoogleCalendar,
  onClose,
}: Props) {
  return (
    <aside className="colab-cal-right">
      <div className="colab-cal-insights-head">
        <div>
          <div className="colab-cal-insights-date">Calendar</div>
          <div className="colab-cal-insights-title">Setup & booking</div>
        </div>
        <button type="button" className="colab-cal-icon-btn colab-cal-insights-close" aria-label="Close setup" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="colab-cal-section">
        <div className="colab-cal-section-head">
          <span>Working hours</span>
        </div>
        <div className="colab-cal-hours-form">
          <label>
            <span>Timezone</span>
            <input
              value={workingHoursForm.timezone}
              onChange={(e) => onWorkingHoursChange({ ...workingHoursForm, timezone: e.target.value })}
            />
          </label>
          <label>
            <span>Start</span>
            <input
              type="time"
              value={workingHoursForm.start}
              onChange={(e) => onWorkingHoursChange({ ...workingHoursForm, start: e.target.value })}
            />
          </label>
          <label>
            <span>End</span>
            <input
              type="time"
              value={workingHoursForm.end}
              onChange={(e) => onWorkingHoursChange({ ...workingHoursForm, end: e.target.value })}
            />
          </label>
          <button type="button" className="colab-cal-outline-btn" disabled={hoursSaving} onClick={() => void onSaveWorkingHours()}>
            Save hours
          </button>
        </div>
      </div>

      <div className="colab-cal-section">
        <div className="colab-cal-section-head">
          <span>Booking pages</span>
        </div>
        <div className="colab-cal-booking-form">
          <input
            placeholder="Page title"
            value={bookingDraft.title}
            onChange={(e) => onBookingDraftChange({ ...bookingDraft, title: e.target.value })}
          />
          <input
            placeholder="slug (optional)"
            value={bookingDraft.slug}
            onChange={(e) => onBookingDraftChange({ ...bookingDraft, slug: e.target.value })}
          />
          <input
            type="number"
            min={5}
            max={480}
            value={bookingDraft.duration_min}
            onChange={(e) => onBookingDraftChange({ ...bookingDraft, duration_min: Number(e.target.value) || 30 })}
          />
          <button type="button" className="colab-cal-outline-btn" disabled={bookingSaving} onClick={() => void onCreateBookingPage()}>
            Create page
          </button>
        </div>
        {bookingPages.length === 0 ? (
          <p className="colab-cal-booking-empty">No booking pages yet.</p>
        ) : (
          bookingPages.map((p) => (
            <div key={p.id} className="colab-cal-cal-row colab-cal-booking-row">
              <span>{p.title}</span>
              <div className="colab-cal-booking-actions">
                <button type="button" className="colab-cal-outline-btn" onClick={() => onCopyBookingLink(p.slug)}>
                  Share
                </button>
                <button type="button" className="colab-cal-text-btn" onClick={() => void onDeactivateBookingPage(p)}>
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="colab-cal-section">
        <div className="colab-cal-section-head">
          <span>My calendars</span>
        </div>
        <div className="colab-cal-calendars">
          <button
            type="button"
            className="colab-cal-cal-row colab-cal-checkbox"
            onClick={() => onSourcesChange((s) => ({ ...s, primary: !s.primary }))}
          >
            <span className="colab-cal-box blue">{sources.primary ? '✓' : ''}</span>
            <span>Inner Animal Media</span>
          </button>
          <button
            type="button"
            className="colab-cal-cal-row colab-cal-checkbox"
            onClick={() => onSourcesChange((s) => ({ ...s, tasks: !s.tasks }))}
          >
            <span className="colab-cal-box task">{sources.tasks ? '✓' : ''}</span>
            <span>Tasks on calendar</span>
          </button>
          <button
            type="button"
            className="colab-cal-cal-row colab-cal-checkbox"
            onClick={() => onSourcesChange((s) => ({ ...s, holidays: !s.holidays }))}
          >
            <span className="colab-cal-box holiday">{sources.holidays ? '✓' : ''}</span>
            <span>Holidays</span>
          </button>
          <button
            type="button"
            className="colab-cal-cal-row colab-cal-checkbox"
            onClick={() => onSourcesChange((s) => ({ ...s, birthdays: !s.birthdays }))}
          >
            <span className="colab-cal-box green">{sources.birthdays ? '✓' : ''}</span>
            <span>Birthdays</span>
          </button>
          <button
            type="button"
            className="colab-cal-cal-row colab-cal-checkbox"
            onClick={() => onSourcesChange((s) => ({ ...s, google_calendar: !s.google_calendar }))}
          >
            <span className="colab-cal-box gcal">{sources.google_calendar ? '✓' : ''}</span>
            <span>Google Calendar</span>
          </button>
          {gcalStatus?.connected ? (
            <div className="colab-cal-gcal-actions">
              <span className="colab-cal-gcal-meta">
                {gcalStatus.accounts?.map((a) => a.account).join(', ')}
                {' · '}
                {gcalStatus.accounts?.some((a) => a.needs_reconnect) ? 'Reconnect for write access' : 'Write sync enabled'}
              </span>
              {gcalStatus.accounts?.some((a) => a.needs_reconnect) && (
                <a className="colab-cal-outline-btn" href="/api/integrations/google-calendar/connect?return_to=/dashboard/collaborate">
                  Reconnect Google
                </a>
              )}
              <span className="colab-cal-gcal-meta">
                {(gcalStatus.accounts?.reduce((n, a) => n + (a.event_count || 0), 0) || 0)} events synced
              </span>
              <button type="button" className="colab-cal-outline-btn" disabled={gcalSyncing} onClick={() => void onSyncGoogleCalendar()}>
                {gcalSyncing ? 'Syncing…' : 'Sync now'}
              </button>
            </div>
          ) : (
            <a className="colab-cal-gcal-connect" href="/api/integrations/google-calendar/connect?return_to=/dashboard/collaborate">
              Connect Google Calendar
            </a>
          )}
        </div>
      </div>
    </aside>
  );
}
