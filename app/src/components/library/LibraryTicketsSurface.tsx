import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  createTicket,
  deleteTicket,
  fetchTicketAnalytics,
  fetchTickets,
  setTicketStatus,
  updateTicket,
  type PlatformTicket,
  type TicketAnalytics,
  type TicketStatus,
} from '../../../client-api/tickets';
import { conicDonutGradient } from '../../lib/chartDonut';
import {
  getTicketPlaybook,
  TICKET_PLAYBOOK_DEPS,
  TICKET_PLAYBOOK_EXEC_ORDER,
  TICKET_PLAYBOOK_NEXT_BATCH,
  type TicketPlaybookEntry,
} from '../../lib/ticketPlaybookCatalog';
import { TicketDetailView } from './TicketDetailView';

type Props = {
  onToast?: (msg: string) => void;
};

type Tab = 'open' | 'blocked' | 'backlog' | 'done';
type ViewMode = 'board' | 'queue';
type SortKey = 'priority' | 'status' | 'updated' | 'title';

const OPEN_STATUSES = new Set<TicketStatus>(['active', 'in_review']);
const DONE_STATUSES = new Set<TicketStatus>(['shipped', 'abandoned']);
const WORKABLE = new Set(['active', 'in_review', 'blocked', 'backlog']);
const RETENTION_DAYS = 90;

const STATUS_DONUT_COLORS: Record<string, string> = {
  shipped: '#34a853',
  abandoned: '#9aa0a6',
  active: '#1a73e8',
  in_review: '#f9ab00',
  blocked: '#d93025',
  backlog: '#5f6368',
};

function statusBadgeClass(status: string): string {
  if (status === 'active' || status === 'in_review') return 'is-active';
  if (status === 'blocked') return 'is-blocked';
  if (status === 'shipped') return 'is-shipped';
  if (status === 'abandoned') return 'is-abandoned';
  return 'is-backlog';
}

function priorityRank(p: string | null): number {
  const u = String(p || '').toUpperCase();
  if (u === 'P0') return 0;
  if (u === 'P1') return 1;
  if (u === 'P2') return 2;
  if (u === 'P3') return 3;
  return 4;
}

function statusRank(s: string): number {
  if (s === 'blocked') return 0;
  if (s === 'active') return 1;
  if (s === 'in_review') return 2;
  if (s === 'backlog') return 3;
  return 4;
}

function sortQueueTickets(a: PlatformTicket, b: PlatformTicket): number {
  const pr = priorityRank(a.priority) - priorityRank(b.priority);
  if (pr !== 0) return pr;
  const sr = statusRank(a.status) - statusRank(b.status);
  if (sr !== 0) return sr;
  return String(a.id).localeCompare(String(b.id));
}

function sortTickets(rows: PlatformTicket[], key: SortKey): PlatformTicket[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    if (key === 'priority') return priorityRank(a.priority) - priorityRank(b.priority) || a.id.localeCompare(b.id);
    if (key === 'status') return statusRank(a.status) - statusRank(b.status) || a.id.localeCompare(b.id);
    if (key === 'updated') return (b.updated_at || 0) - (a.updated_at || 0);
    return String(a.title).localeCompare(String(b.title));
  });
  return copy;
}

function linkCount(t: PlatformTicket): number {
  return (t.blocks?.length || 0) + (t.blocked_by?.length || 0);
}

function linkTooltip(t: PlatformTicket): string {
  const parts: string[] = [];
  if (t.blocked_by?.length) parts.push(`Blocked by: ${t.blocked_by.join(', ')}`);
  if (t.blocks?.length) parts.push(`Blocks: ${t.blocks.join(', ')}`);
  return parts.join('\n') || 'No links';
}

function daysClosed(t: PlatformTicket): number | null {
  if (!DONE_STATUSES.has(t.status) || !t.closed_at) return null;
  return Math.floor((Date.now() / 1000 - t.closed_at) / 86400);
}

function QueueCard({
  ticket,
  playbook,
  checked,
  onCheck,
  onOpen,
}: {
  ticket: PlatformTicket;
  playbook: TicketPlaybookEntry | null;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <article className={`lib-playbook-card${checked ? ' is-selected' : ''}`}>
      <header className="lib-playbook-card__head">
        <label className="lib-ticket-check" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheck(e.target.checked)}
            aria-label={`Select ${ticket.id}`}
          />
        </label>
        <button type="button" className="lib-ticket-open-title" onClick={onOpen}>
          <code>{ticket.id}</code>
        </button>
        <div className="lib-playbook-card__pills">
          <span className={`lib-ticket-pri lib-ticket-pri--${(ticket.priority || 'px').toLowerCase()}`}>
            {ticket.priority || '—'}
          </span>
          <span className={`lib-ticket-status ${statusBadgeClass(ticket.status)}`}>{ticket.status}</span>
          {ticket.subsystem ? <span className="lib-playbook-pill">{ticket.subsystem}</span> : null}
          {linkCount(ticket) > 0 ? (
            <span className="lib-ticket-linkchip" title={linkTooltip(ticket)}>
              ⛓ {linkCount(ticket)}
            </span>
          ) : null}
        </div>
      </header>
      <h3>
        <button type="button" className="lib-ticket-open-title" onClick={onOpen}>
          {ticket.title}
        </button>
      </h3>
      {playbook ? (
        <div className="lib-playbook-card__body">
          <section>
            <strong>What it is</strong>
            <p>{playbook.what}</p>
          </section>
          <section>
            <strong>Needed</strong>
            <p>{playbook.needed}</p>
          </section>
          <div className="lib-playbook-card__pf">
            <section>
              <strong>Pass</strong>
              <p>{playbook.pass}</p>
            </section>
            <section>
              <strong>Fail</strong>
              <p>{playbook.fail}</p>
            </section>
          </div>
          <section>
            <strong>Deliverable</strong>
            <p>{playbook.deliverable}</p>
          </section>
          <section>
            <strong>Recommended steps</strong>
            <p>{playbook.steps}</p>
          </section>
        </div>
      ) : (
        <p className="lib-playbook-card__fallback">
          {ticket.status_reason ||
            'No queue contract yet — use title, status reason, and plan path until one is authored.'}
          {ticket.doc_path ? (
            <>
              <br />
              <code>{ticket.doc_path}</code>
            </>
          ) : null}
        </p>
      )}
    </article>
  );
}

function QueueSection({
  title,
  tickets,
  checkedIds,
  onCheck,
  onOpen,
  defaultOpen = true,
}: {
  title: string;
  tickets: PlatformTicket[];
  checkedIds: Set<string>;
  onCheck: (id: string, checked: boolean) => void;
  onOpen: (id: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!tickets.length) return null;
  return (
    <section className="lib-playbook-section">
      <button
        type="button"
        className="lib-playbook-section__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{open ? '▾' : '▸'}</span>
        {title}
        <em>{tickets.length}</em>
      </button>
      {open ? (
        <div className="lib-playbook-section__cards">
          {tickets.map((t) => (
            <QueueCard
              key={t.id}
              ticket={t}
              playbook={getTicketPlaybook(t.id)}
              checked={checkedIds.has(t.id)}
              onCheck={(c) => onCheck(t.id, c)}
              onOpen={() => onOpen(t.id)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function TicketStatsPanel({ analytics }: { analytics: TicketAnalytics }) {
  const statusDonut = useMemo(() => {
    const by = analytics.by_status || {};
    const slices = Object.entries(by)
      .filter(([, n]) => Number(n) > 0)
      .map(([key, val]) => ({
        key,
        color: STATUS_DONUT_COLORS[key] || '#dadce0',
        val: Number(val) || 0,
      }));
    if (!slices.length) slices.push({ key: 'empty', color: '#3c4043', val: 1 });
    return conicDonutGradient(slices);
  }, [analytics]);

  const maxShipped = useMemo(() => {
    const rows = analytics.throughput || [];
    return Math.max(1, ...rows.map((r) => Number(r.shipped) || 0));
  }, [analytics]);

  return (
    <div className="lib-tickets__analytics lib-tickets__analytics--panel">
      <div className="lib-tickets__stat-tiles">
        <div className="lib-tickets__stat">
          <span>Completion</span>
          <strong>{Math.round((analytics.completion_rate || 0) * 100)}%</strong>
        </div>
        <div className="lib-tickets__stat">
          <span>Avg cycle</span>
          <strong>
            {analytics.avg_cycle_days != null ? `${analytics.avg_cycle_days.toFixed(1)}d` : '—'}
          </strong>
        </div>
        <div className="lib-tickets__stat">
          <span>Oldest active</span>
          <strong>{analytics.oldest_active_days}d</strong>
        </div>
      </div>
      <div className="lib-tickets__charts">
        <div className="lib-tickets__throughput" aria-label="Shipped per week">
          <div className="lib-tickets__chart-label">Throughput (shipped / week)</div>
          <div className="lib-tickets__bars">
            {(analytics.throughput || []).map((row) => {
              const n = Number(row.shipped) || 0;
              const h = Math.max(4, Math.round((n / maxShipped) * 64));
              return (
                <div key={row.week} className="lib-tickets__bar-col" title={`${row.week}: ${n}`}>
                  <div className="lib-tickets__bar" style={{ height: h }} />
                  <em>{n}</em>
                </div>
              );
            })}
            {!analytics.throughput?.length ? <span className="lib-empty">No shipped events yet</span> : null}
          </div>
        </div>
        <div className="lib-tickets__donut-wrap">
          <div className="lib-tickets__chart-label">Status mix</div>
          <div className="lib-tickets__donut" style={{ background: statusDonut }} />
          <ul className="lib-tickets__donut-legend">
            {Object.entries(analytics.by_status || {}).map(([k, n]) => (
              <li key={k}>
                <i style={{ background: STATUS_DONUT_COLORS[k] || '#dadce0' }} />
                {k} <em>{n}</em>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function LibraryTicketsSurface({ onToast }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { ticketId: paramTicketId } = useParams<{ ticketId?: string }>();
  const routeTicketId =
    paramTicketId ||
    location.pathname.match(/^\/dashboard\/artifacts\/tickets\/([^/]+)\/?$/)?.[1] ||
    undefined;

  const [tickets, setTickets] = useState<PlatformTicket[]>([]);
  const [analytics, setAnalytics] = useState<TicketAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('open');
  const [viewMode, setViewMode] = useState<ViewMode>('queue');
  const [statsOpen, setStatsOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('priority');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState('P2');
  const [newProject, setNewProject] = useState('');
  const [busy, setBusy] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<TicketStatus>('active');
  const [bulkPriority, setBulkPriority] = useState('P2');
  const [bulkReason, setBulkReason] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, stats] = await Promise.all([
        fetchTickets({ limit: 200 }),
        fetchTicketAnalytics().catch(() => null),
      ]);
      setTickets(rows);
      setAnalytics(stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tickets');
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openTicket = useCallback(
    (id: string) => {
      navigate(`/dashboard/artifacts/tickets/${encodeURIComponent(id)}`);
    },
    [navigate],
  );

  const backToList = useCallback(() => {
    navigate('/dashboard/artifacts/tickets');
  }, [navigate]);

  const counts = useMemo(() => {
    let open = 0;
    let blocked = 0;
    let backlog = 0;
    let done = 0;
    let staleDone = 0;
    for (const t of tickets) {
      if (OPEN_STATUSES.has(t.status)) open += 1;
      else if (t.status === 'blocked') blocked += 1;
      else if (t.status === 'backlog') backlog += 1;
      else if (DONE_STATUSES.has(t.status)) {
        done += 1;
        const d = daysClosed(t);
        if (d != null && d >= RETENTION_DAYS) staleDone += 1;
      }
    }
    return { open, blocked, backlog, done, staleDone };
  }, [tickets]);

  const priorityStats = useMemo(() => {
    const openish = tickets.filter((t) => WORKABLE.has(t.status));
    let p0 = 0;
    let p1 = 0;
    let p2p3 = 0;
    let blocked = 0;
    for (const t of openish) {
      if (t.status === 'blocked') blocked += 1;
      const u = String(t.priority || '').toUpperCase();
      if (u === 'P0') p0 += 1;
      else if (u === 'P1') p1 += 1;
      else p2p3 += 1;
    }
    return { p0, p1, p2p3, blocked, total: openish.length };
  }, [tickets]);

  const queueGroups = useMemo(() => {
    const openish = tickets.filter((t) => WORKABLE.has(t.status)).sort(sortQueueTickets);
    return {
      inReview: openish.filter((t) => t.status === 'in_review'),
      active: openish.filter((t) => t.status === 'active'),
      p0Backlog: openish.filter(
        (t) => t.status === 'backlog' && String(t.priority || '').toUpperCase() === 'P0',
      ),
      p1Blocked: openish.filter(
        (t) =>
          (t.status === 'backlog' || t.status === 'blocked') &&
          String(t.priority || '').toUpperCase() === 'P1',
      ),
      p2p3: openish.filter((t) => {
        const p = String(t.priority || '').toUpperCase();
        return (p === 'P2' || p === 'P3' || !p) && (t.status === 'backlog' || t.status === 'blocked');
      }),
    };
  }, [tickets]);

  const visible = useMemo(() => {
    const filtered = tickets.filter((t) => {
      if (tab === 'open') return OPEN_STATUSES.has(t.status);
      if (tab === 'blocked') return t.status === 'blocked';
      if (tab === 'backlog') return t.status === 'backlog';
      return DONE_STATUSES.has(t.status);
    });
    return sortTickets(filtered, sortKey);
  }, [tickets, tab, sortKey]);

  const statsChipLabel = useMemo(() => {
    if (!analytics) return 'Stats';
    const pct = Math.round((analytics.completion_rate || 0) * 100);
    const cycle =
      analytics.avg_cycle_days != null ? `${analytics.avg_cycle_days.toFixed(1)}d avg` : 'no cycle';
    return `${pct}% complete · ${cycle} · oldest ${analytics.oldest_active_days}d`;
  }, [analytics]);

  const setChecked = (id: string, checked: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleSelectVisible = () => {
    const ids = viewMode === 'board' ? visible.map((t) => t.id) : tickets.filter((t) => WORKABLE.has(t.status)).map((t) => t.id);
    setCheckedIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(ids);
    });
  };

  const clearSelection = () => setCheckedIds(new Set());

  const handleCreate = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setBusy(true);
    try {
      const project = newProject.trim() || undefined;
      const ticket = await createTicket({
        title,
        priority: newPriority,
        status: 'backlog',
        ...(project ? { project } : {}),
        subsystem: 'platform',
      });
      setNewTitle('');
      setNewProject('');
      setCreateOpen(false);
      onToast?.(`Created ${ticket.id}`);
      await refresh();
      openTicket(ticket.id);
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const runBulkStatus = async () => {
    const ids = [...checkedIds];
    if (!ids.length) return;
    if ((bulkStatus === 'blocked' || bulkStatus === 'abandoned') && !bulkReason.trim()) {
      onToast?.('Status reason required for blocked / abandoned');
      return;
    }
    setBusy(true);
    try {
      await Promise.all(
        ids.map((id) =>
          setTicketStatus(id, {
            status: bulkStatus,
            status_reason: bulkReason.trim() || undefined,
          }),
        ),
      );
      onToast?.(`Updated status on ${ids.length}`);
      clearSelection();
      setBulkReason('');
      await refresh();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Bulk status failed');
    } finally {
      setBusy(false);
    }
  };

  const runBulkPriority = async () => {
    const ids = [...checkedIds];
    if (!ids.length) return;
    setBusy(true);
    try {
      await Promise.all(ids.map((id) => updateTicket(id, { priority: bulkPriority })));
      onToast?.(`Set priority ${bulkPriority} on ${ids.length}`);
      clearSelection();
      await refresh();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Bulk priority failed');
    } finally {
      setBusy(false);
    }
  };

  const runBulkDelete = async () => {
    const ids = [...checkedIds];
    if (!ids.length) return;
    const ok = window.confirm(
      `Permanently delete ${ids.length} ticket${ids.length === 1 ? '' : 's'}? This cannot be undone.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await Promise.all(ids.map((id) => deleteTicket(id)));
      onToast?.(`Deleted ${ids.length}`);
      clearSelection();
      await refresh();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Bulk delete failed');
    } finally {
      setBusy(false);
    }
  };

  const selectStaleDone = () => {
    const stale = tickets.filter((t) => {
      const d = daysClosed(t);
      return d != null && d >= RETENTION_DAYS;
    });
    setCheckedIds(new Set(stale.map((t) => t.id)));
    setViewMode('board');
    setTab('done');
    onToast?.(stale.length ? `Selected ${stale.length} closed ≥${RETENTION_DAYS}d` : `None closed ≥${RETENTION_DAYS}d`);
  };

  if (routeTicketId) {
    return (
      <div className="lib-tickets lib-tickets--detail">
        <TicketDetailView
          ticketId={routeTicketId}
          onBack={backToList}
          onToast={onToast}
          onDeleted={() => void refresh()}
        />
      </div>
    );
  }

  return (
    <div className="lib-tickets">
      <div className="lib-tickets__toolbar lib-tickets__toolbar--single">
        <div className="lib-tickets__tabs" role="tablist" aria-label="View mode">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'queue'}
            className={`lib-tickets__tab${viewMode === 'queue' ? ' is-active' : ''}`}
            onClick={() => setViewMode('queue')}
          >
            Queue
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'board'}
            className={`lib-tickets__tab${viewMode === 'board' ? ' is-active' : ''}`}
            onClick={() => setViewMode('board')}
          >
            Board
          </button>
        </div>

        <button
          type="button"
          className={`lib-tickets__stats-chip${statsOpen ? ' is-open' : ''}`}
          aria-expanded={statsOpen}
          onClick={() => setStatsOpen((v) => !v)}
          title="Show analytics"
        >
          {statsChipLabel}
        </button>

        {viewMode === 'board' ? (
          <div className="lib-tickets__tabs lib-tickets__filter-tabs" role="tablist" aria-label="Status filter">
            {(
              [
                ['open', 'Open', counts.open],
                ['blocked', 'Blocked', counts.blocked],
                ['backlog', 'Backlog', counts.backlog],
                ['done', 'Done', counts.done],
              ] as const
            ).map(([key, label, n]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`lib-tickets__tab lib-tickets__tab--filter${tab === key ? ' is-active' : ''}`}
                onClick={() => setTab(key)}
              >
                {label}
                <em>{n}</em>
              </button>
            ))}
          </div>
        ) : null}

        <div className="lib-tickets__actions">
          <label className="lib-tickets__sort">
            <span className="sr-only">Sort</span>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              aria-label="Sort tickets"
            >
              <option value="priority">Sort: priority</option>
              <option value="status">Sort: status</option>
              <option value="updated">Sort: updated</option>
              <option value="title">Sort: title</option>
            </select>
          </label>
          <button type="button" className="lib-ticket-btn" onClick={() => void refresh()}>
            Refresh
          </button>
          <button
            type="button"
            className="lib-ticket-btn lib-ticket-btn--primary"
            onClick={() => setCreateOpen((v) => !v)}
          >
            New ticket
          </button>
        </div>
      </div>

      {statsOpen && analytics ? <TicketStatsPanel analytics={analytics} /> : null}

      {statsOpen && viewMode === 'queue' ? (
        <div className="lib-playbook__stats lib-playbook__stats--compact">
          <div className="lib-playbook__stat is-p0">
            <strong>{priorityStats.p0}</strong>
            <span>P0 open</span>
          </div>
          <div className="lib-playbook__stat is-p1">
            <strong>{priorityStats.p1}</strong>
            <span>P1 open</span>
          </div>
          <div className="lib-playbook__stat">
            <strong>{priorityStats.p2p3}</strong>
            <span>P2/P3</span>
          </div>
          <div className="lib-playbook__stat is-blocked">
            <strong>{priorityStats.blocked}</strong>
            <span>Blocked</span>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className="lib-tickets__create">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Ticket title"
            aria-label="Ticket title"
          />
          <input
            value={newProject}
            onChange={(e) => setNewProject(e.target.value)}
            placeholder="projects.id (optional)"
            aria-label="Project id"
          />
          <select
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value)}
            aria-label="Priority"
          >
            {['P0', 'P1', 'P2', 'P3'].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="lib-ticket-btn lib-ticket-btn--primary"
            disabled={busy}
            onClick={() => void handleCreate()}
          >
            Create
          </button>
        </div>
      ) : null}

      {checkedIds.size > 0 ? (
        <div className="lib-tickets__bulk" role="region" aria-label="Bulk actions">
          <strong>{checkedIds.size} selected</strong>
          <button type="button" className="lib-ticket-btn" onClick={toggleSelectVisible}>
            Select visible
          </button>
          <button type="button" className="lib-ticket-btn" onClick={clearSelection}>
            Clear
          </button>
          <select
            value={bulkPriority}
            onChange={(e) => setBulkPriority(e.target.value)}
            aria-label="Bulk priority"
          >
            {['P0', 'P1', 'P2', 'P3'].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="lib-ticket-btn"
            disabled={busy}
            onClick={() => void runBulkPriority()}
          >
            Set priority
          </button>
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as TicketStatus)}
            aria-label="Bulk status"
          >
            {(['active', 'blocked', 'backlog', 'in_review', 'shipped', 'abandoned'] as TicketStatus[]).map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ),
            )}
          </select>
          {(bulkStatus === 'blocked' || bulkStatus === 'abandoned') && (
            <input
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              placeholder="Reason required…"
              aria-label="Bulk status reason"
            />
          )}
          <button
            type="button"
            className="lib-ticket-btn"
            disabled={busy}
            onClick={() => void runBulkStatus()}
          >
            Set status
          </button>
          <button
            type="button"
            className="lib-ticket-btn lib-ticket-btn--danger"
            disabled={busy}
            onClick={() => void runBulkDelete()}
          >
            Delete
          </button>
          {counts.staleDone > 0 ? (
            <button type="button" className="lib-ticket-btn" onClick={selectStaleDone}>
              Select closed ≥{RETENTION_DAYS}d ({counts.staleDone})
            </button>
          ) : null}
        </div>
      ) : (
        <div className="lib-tickets__organize">
          <button type="button" className="lib-ticket-btn" onClick={toggleSelectVisible}>
            Select visible
          </button>
          {counts.staleDone > 0 ? (
            <button type="button" className="lib-ticket-btn" onClick={selectStaleDone}>
              Organize: closed ≥{RETENTION_DAYS}d ({counts.staleDone})
            </button>
          ) : null}
        </div>
      )}

      {error ? <div className="lib-error">{error}</div> : null}

      {viewMode === 'queue' ? (
        <div className="lib-playbook">
          {loading ? (
            <div className="lib-loading">Loading queue…</div>
          ) : (
            <>
              <div className="lib-playbook__callout">
                <strong>Recommended execution order</strong>
                <p>{TICKET_PLAYBOOK_EXEC_ORDER}</p>
              </div>

              <div className="lib-playbook__batch">
                <h2>Suggested next batch</h2>
                <table>
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Why now</th>
                      <th>Validation shortcut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TICKET_PLAYBOOK_NEXT_BATCH.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <button
                            type="button"
                            className="lib-ticket-open-title"
                            onClick={() => openTicket(row.id)}
                          >
                            <code>{row.id}</code>
                          </button>
                        </td>
                        <td>{row.why}</td>
                        <td>{row.validation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="lib-playbook__deps">
                <h2>Dependency sketch</h2>
                <ul>
                  {TICKET_PLAYBOOK_DEPS.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>

              <QueueSection
                title="In review — close with proof"
                tickets={queueGroups.inReview}
                checkedIds={checkedIds}
                onCheck={setChecked}
                onOpen={openTicket}
              />
              <QueueSection
                title="Active — work in flight"
                tickets={queueGroups.active}
                checkedIds={checkedIds}
                onCheck={setChecked}
                onOpen={openTicket}
              />
              <QueueSection
                title="P0 backlog"
                tickets={queueGroups.p0Backlog}
                checkedIds={checkedIds}
                onCheck={setChecked}
                onOpen={openTicket}
                defaultOpen={false}
              />
              <QueueSection
                title="P1 backlog + blocked"
                tickets={queueGroups.p1Blocked}
                checkedIds={checkedIds}
                onCheck={setChecked}
                onOpen={openTicket}
                defaultOpen={false}
              />
              <QueueSection
                title="P2 / P3"
                tickets={queueGroups.p2p3}
                checkedIds={checkedIds}
                onCheck={setChecked}
                onOpen={openTicket}
                defaultOpen={false}
              />
            </>
          )}
        </div>
      ) : (
        <div className="lib-tickets__list lib-tickets__list--full">
          {loading ? (
            <div className="lib-loading">Loading tickets…</div>
          ) : visible.length === 0 ? (
            <div className="lib-empty">No tickets in this tab</div>
          ) : (
            visible.map((t) => {
              const stale = daysClosed(t);
              return (
                <div
                  key={t.id}
                  className={`lib-ticket-row lib-ticket-row--board${checkedIds.has(t.id) ? ' is-selected' : ''}${
                    stale != null && stale >= RETENTION_DAYS ? ' is-stale' : ''
                  }`}
                >
                  <label className="lib-ticket-check" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checkedIds.has(t.id)}
                      onChange={(e) => setChecked(t.id, e.target.checked)}
                      aria-label={`Select ${t.id}`}
                    />
                  </label>
                  <button type="button" className="lib-ticket-row__hit" onClick={() => openTicket(t.id)}>
                    <span className={`lib-ticket-pri lib-ticket-pri--${(t.priority || 'px').toLowerCase()}`}>
                      {t.priority || '—'}
                    </span>
                    <span className="lib-ticket-row__main">
                      <strong>{t.title}</strong>
                      <small>
                        {t.id}
                        {t.subsystem ? ` · ${t.subsystem}` : ''}
                        {stale != null && stale >= RETENTION_DAYS ? ` · closed ${stale}d` : ''}
                      </small>
                    </span>
                    {linkCount(t) > 0 ? (
                      <span className="lib-ticket-linkchip" title={linkTooltip(t)}>
                        ⛓ {linkCount(t)}
                      </span>
                    ) : null}
                    <span className={`lib-ticket-status ${statusBadgeClass(t.status)}`}>{t.status}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
