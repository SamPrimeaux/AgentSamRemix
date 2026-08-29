/**
 * MailPage.tsx — IAM Dashboard Mail
 * Multi-account (Gmail + Resend), full CRUD, Agent Sam AI panel (Gemini-driven via D1 subagent profiles).
 * Mobile: sidebar collapses to a slide-in drawer; list and detail each go full-width.
 */
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CollaborateWorkShell } from '../src/components/collaborate/CollaborateWorkShell';
import { CollaborateCalendarLeftNav } from '../src/components/collaborate/CollaborateCalendarLeftNav';
import { CollaboratePageRail } from '../src/components/collaborate/CollaboratePageRail';
import { MailTimeInsightsPanel } from '../src/components/collaborate/MailTimeInsightsPanel';
import { openMailAgent } from '../lib/askMailAgent';
import { parseMailNextSteps, stripMailNextStepsPayload } from '../lib/mailNextSteps';
import { publishMailSurfaceContext } from '../lib/mailSurfaceEvents';
import '../pages/launch-desk/collaborate-calendar.css';
import '../src/components/collaborate/mail-work-surface.css';
import {
  AlertTriangle, Archive, Bot, CheckCircle, ChevronLeft, ChevronRight, Circle, Clock,
  Forward, Inbox, Mail, Paperclip, Plus, RefreshCw, Reply,
  Search, Send, Settings, Star, Tag, Trash2, X,
  Bell,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Account {
  id: string;           // 'gmail' | 'resend' | 'platform'
  label: string;
  address: string;
  provider: 'gmail' | 'resend' | 'platform';
  connected: boolean;
}

interface Email {
  id: string;
  from_address: string;
  to_address: string;
  subject: string;
  date_received: string;
  is_read: number;
  is_starred: number;
  is_archived: number;
  category?: string;
  has_attachments: number;
  account?: string;
  _outbox?: {
    status?: string | null;
    event_type?: string | null;
    attempts?: number | null;
    max_attempts?: number | null;
    last_error?: string | null;
    body_text?: string | null;
  };
}

interface EmailDetail {
  email: Email & { metadata?: Record<string, unknown> };
  body: string | null;
  attachments: { id: string; filename: string; content_type: string; size: number }[];
  thread: Email[];
}

interface ComposeState {
  from: string;
  to: string;
  subject: string;
  body: string;
  template_id: string;
  reply_to: string;
  in_reply_to: string;
  thread_id: string;
}

type Folder = 'inbox' | 'starred' | 'archived' | 'sent' | 'outbound' | 'templates';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return mobile;
}

function initials(addr: string) {
  const s = String(addr || '').trim();
  if (!s) return '??';
  const base = s.includes('<') ? s.split('<')[0].trim() : s;
  const parts = base.replace(/['"]/g, '').split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function avatarColor(addr: string): string {
  const palette = ['var(--solar-cyan)', 'var(--solar-yellow)', 'var(--solar-orange)', '#8b5cf6', '#06b6d4'];
  return palette[(String(addr || '').trim().toLowerCase().charCodeAt(0) || 0) % palette.length];
}

function fmtDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso + 'Z');
  if (isNaN(d.getTime())) return iso;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fmtSize(bytes: number) {
  const n = Number(bytes || 0);
  if (!isFinite(n) || n <= 0) return '—';
  const kb = n / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function isHtml(body: string) {
  const s = body.trim();
  return s.startsWith('<') || /<html[\s>]|<body[\s>]|<div[\s>]/i.test(s);
}

function accountQuery(activeAccount: string) {
  if (!activeAccount || activeAccount === 'all') return '';
  const acct = activeAccount.startsWith('gmail:') ? activeAccount.slice(6) : activeAccount;
  return `?account=${encodeURIComponent(acct)}`;
}

function EmailHtmlPreview({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const resize = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame?.contentDocument?.body) return;
    frame.style.height = `${Math.max(frame.contentDocument.body.scrollHeight + 24, 320)}px`;
  }, []);
  useEffect(() => {
    resize();
    const t = window.setTimeout(resize, 120);
    return () => window.clearTimeout(t);
  }, [html, resize]);
  return (
    <iframe
      ref={iframeRef}
      srcDoc={html}
      sandbox="allow-same-origin"
      onLoad={resize}
      title="email-body"
      style={{
        width: '100%',
        minHeight: 320,
        flex: 1,
        border: 'none',
        background: '#fff',
        borderRadius: 8,
        display: 'block',
      }}
    />
  );
}

const SIDEBAR_MIN = 160; const SIDEBAR_MAX = 340;
const DETAIL_MIN = 300;  const DETAIL_MAX = 740;

// ─── Sub-components ───────────────────────────────────────────────────────────

function Btn({ onClick, title, children, active = false, danger = false, small = false }:
  { onClick: () => void; title?: string; children: React.ReactNode; active?: boolean; danger?: boolean; small?: boolean }) {
  return (
    <button type="button" title={title} onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      gap: 6, height: small ? 28 : 32, padding: small ? '0 8px' : '0 12px',
      borderRadius: 8, border: '1px solid var(--border-subtle)',
      background: active ? 'var(--bg-hover)' : 'transparent',
      color: danger ? 'var(--solar-orange)' : active ? 'var(--text-main)' : 'var(--text-muted)',
      fontSize: small ? 11 : 12, fontWeight: 700, cursor: 'pointer',
      transition: 'background 0.12s, color 0.12s',
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; (e.currentTarget as HTMLElement).style.color = danger ? '#ef4444' : 'var(--text-main)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = active ? 'var(--bg-hover)' : 'transparent'; (e.currentTarget as HTMLElement).style.color = danger ? 'var(--solar-orange)' : active ? 'var(--text-main)' : 'var(--text-muted)'; }}
    >{children}</button>
  );
}

// ─── Sidebar content (shared between desktop inline + mobile drawer) ──────────

function SidebarContent({
  accounts, activeAccount, setActiveAccount,
  folder, setFolder, stats,
  loadEmails, loadStats,
  setComposing, setCompose,
  onClose,
}: {
  accounts: Account[];
  activeAccount: string;
  setActiveAccount: (id: string) => void;
  folder: Folder;
  setFolder: (f: Folder) => void;
  stats: { total: number; unread: number; starred: number };
  loadEmails: () => void;
  loadStats: () => void;
  setComposing: (v: boolean) => void;
  setCompose: React.Dispatch<React.SetStateAction<ComposeState>>;
  onClose?: () => void;
}) {
  const FOLDERS: { id: Folder; label: string; icon: React.ReactNode }[] = [
    { id: 'inbox', label: 'Inbox', icon: <Inbox size={14} /> },
    { id: 'starred', label: 'Starred', icon: <Star size={14} /> },
    { id: 'sent', label: 'Sent', icon: <Send size={14} /> },
    { id: 'outbound', label: 'Outbound', icon: <Bell size={14} /> },
    { id: 'archived', label: 'Archived', icon: <Archive size={14} /> },
  ];

  return (
    <>
      <CollaborateCalendarLeftNav active="mail" />
      {/* Header */}
      <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <Btn onClick={() => { loadEmails(); loadStats(); onClose?.(); }} title="Refresh" small><RefreshCw size={13} /></Btn>
            <Btn onClick={() => { setComposing(true); setCompose(c => ({ ...c, to: '', subject: '', body: '' })); onClose?.(); }} title="Compose" small><Plus size={13} />Compose</Btn>
          </div>
          {onClose ? (
            <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
              <X size={16} />
            </button>
          ) : null}
        </div>

        {/* Account switcher */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button type="button" onClick={() => { setActiveAccount('all'); onClose?.(); }} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, padding: '0 8px', borderRadius: 7, border: 'none', background: activeAccount === 'all' ? 'var(--bg-hover)' : 'transparent', color: 'var(--text-main)', fontSize: 11, fontWeight: activeAccount === 'all' ? 800 : 500, cursor: 'pointer', textAlign: 'left', flex: 1, minWidth: 0 }}>
              <Mail size={12} style={{ color: 'var(--solar-cyan)', flexShrink: 0 }} />All accounts
            </button>
            <a href="/api/integrations/gmail/connect?return_to=%2Fdashboard%2Fmail" title="Connect another Gmail account" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 7, background: 'var(--bg-hover)', color: 'var(--solar-cyan)', textDecoration: 'none', flexShrink: 0 }}>
              <Plus size={13} />
            </a>
          </div>
          {accounts.map(acc => (
            <button key={acc.id} type="button" onClick={() => { setActiveAccount(acc.id); onClose?.(); }} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, padding: '0 8px', borderRadius: 7, border: 'none', background: activeAccount === acc.id ? 'var(--bg-hover)' : 'transparent', color: acc.connected ? 'var(--text-main)' : 'var(--text-muted)', fontSize: 11, fontWeight: activeAccount === acc.id ? 800 : 400, cursor: 'pointer', textAlign: 'left', width: '100%', overflow: 'hidden' }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: acc.connected ? 'var(--solar-cyan)' : 'var(--text-muted)', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {acc.label}{acc.address ? ` · ${acc.address.split('@')[0]}` : ''}
              </span>
            </button>
          ))}
          {!accounts.some(a => a.provider === 'gmail' && a.connected) && (
            <a href="/api/integrations/gmail/connect?return_to=%2Fdashboard%2Fmail" style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 8px', borderRadius: 7, background: 'var(--bg-hover)', color: 'var(--solar-cyan)', fontSize: 10, fontWeight: 700, textDecoration: 'none', marginTop: 2 }}>
              <Plus size={11} />Connect Gmail
            </a>
          )}
        </div>
      </div>

      {/* Folders */}
      <div style={{ padding: '8px 8px 4px', flexShrink: 0 }}>
        {FOLDERS.map(f => (
          <button key={f.id} type="button" onClick={() => { setFolder(f.id); onClose?.(); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 32, padding: '0 8px', borderRadius: 7, border: 'none', background: folder === f.id ? 'var(--bg-hover)' : 'transparent', color: folder === f.id ? 'var(--text-main)' : 'var(--text-muted)', fontSize: 12, fontWeight: folder === f.id ? 800 : 400, cursor: 'pointer', textAlign: 'left' }}>
            {f.icon}
            <span style={{ flex: 1 }}>{f.label}</span>
            {f.id === 'inbox' && stats.unread > 0 && (
              <span style={{ fontSize: 10, fontWeight: 800, background: 'var(--solar-cyan)', color: '#000', borderRadius: 99, padding: '1px 6px' }}>{stats.unread}</span>
            )}
          </button>
        ))}
      </div>

      {/* Stats footer */}
      <div style={{ marginTop: 'auto', padding: '10px 14px', borderTop: '1px solid var(--border-subtle)', fontSize: 10, color: 'var(--text-muted)' }}>
        {stats.total} total · {stats.unread} unread · {stats.starred} starred
      </div>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const deepLinkEmailHandled = useRef<string | null>(null);
  const deepLinkConvHandled = useRef<string | null>(null);
  const [nextStepBusy, setNextStepBusy] = useState<string | null>(null);
  const [nextStepMsg, setNextStepMsg] = useState<string | null>(null);

  // Panels
  const [sidebarW, setSidebarW] = useState(() => {
    try { return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Number(localStorage.getItem('mail_sidebar_w') || 220))); } catch { return 220; }
  });
  const [detailW, setDetailW] = useState(() => {
    try { return Math.min(DETAIL_MAX, Math.max(DETAIL_MIN, Number(localStorage.getItem('mail_detail_w') || 460))); } catch { return 460; }
  });
  const resizingRef = useRef<{ panel: 'sidebar' | 'detail'; startX: number; startW: number } | null>(null);

  // Accounts
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccount, setActiveAccount] = useState<string>('');

  // Email state
  const [folder, setFolder] = useState<Folder>('inbox');
  const [emails, setEmails] = useState<Email[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selected, setSelected] = useState<Email | null>(null);
  const [detail, setDetail] = useState<EmailDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ total: 0, unread: 0, starred: 0 });
  const [listPage, setListPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [listPageSize, setListPageSize] = useState(50);
  const [listSource, setListSource] = useState<'gmail' | 'd1' | 'outbox' | ''>('');
  const [gmailPageTokens, setGmailPageTokens] = useState<Record<number, string>>({});
  const gmailPageTokensRef = useRef<Record<number, string>>({});
  const listSourceRef = useRef<'gmail' | 'd1' | 'outbox' | ''>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // Compose
  const [composing, setComposing] = useState(false);
  const [compose, setCompose] = useState<ComposeState>({
    from: '', to: '', subject: '', body: '', template_id: '', reply_to: '', in_reply_to: '', thread_id: '',
  });
  const [senders, setSenders] = useState<{ id: string; address: string; label?: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Close drawer when switching to desktop
  useEffect(() => { if (!isMobile) setDrawerOpen(false); }, [isMobile]);

  const handleMailAgent = useCallback(() => {
    openMailAgent({
      inboxPreview: emails.map((e) => ({
        id: e.id,
        subject: e.subject,
        from: e.from_address,
        date: e.date_received,
        is_read: e.is_read,
      })),
      focus: selected
        ? {
          id: selected.id,
          subject: selected.subject,
          from: selected.from_address,
          to: selected.to_address,
          account: selected.account,
          bodyPreview: detail?.body || undefined,
        }
        : undefined,
      message: selected
        ? 'Summarize this open email and suggest whether I should reply, archive, or follow up. Use gmail_get_message on the focused message id if the preview is not enough.'
        : undefined,
    });
  }, [emails, selected, detail]);

  useEffect(() => {
    const gmailConnected = accounts.some((a) => a.provider === 'gmail' && a.connected);
    publishMailSurfaceContext({
      surface: 'mail',
      route: '/dashboard/mail',
      folder,
      account: activeAccount || null,
      search,
      gmailConnected,
      inboxPreview: emails.map((e) => ({
        id: e.id,
        subject: e.subject,
        from: e.from_address,
        date: e.date_received,
        is_read: e.is_read,
      })),
      selected: selected
        ? {
          id: selected.id,
          subject: selected.subject,
          from: selected.from_address,
          to: selected.to_address,
          account: selected.account,
          bodyPreview: detail?.body ? detail.body.slice(0, 3000) : undefined,
        }
        : null,
    });
  }, [accounts, emails, selected, detail, folder, activeAccount, search]);

  // ── Load accounts ──────────────────────────────────────────────────────────
  const loadAccounts = useCallback(async () => {
    const accs: Account[] = [];
    try {
      const gmailRes = await fetch('/api/mail/gmail/accounts', { credentials: 'same-origin' });
      if (gmailRes.ok) {
        const gd = await gmailRes.json();
        for (const g of gd.accounts || []) {
          const addr = String(g.address || g.id || '').trim();
          if (!addr) continue;
          accs.push({ id: `gmail:${addr}`, label: 'Gmail', address: addr, provider: 'gmail', connected: true });
        }
      }
    } catch { /* skip */ }
    if (accs.length === 0) {
      try {
        const statusRes = await fetch('/api/mail/gmail/status', { credentials: 'same-origin' });
        if (statusRes.ok) {
          const gd = await statusRes.json();
          if (gd.connected && gd.account) {
            accs.push({ id: `gmail:${gd.account}`, label: 'Gmail', address: gd.account, provider: 'gmail', connected: true });
          }
        }
      } catch { /* skip */ }
    }
    try {
      const sRes = await fetch('/api/mail/senders', { credentials: 'same-origin' });
      if (sRes.ok) {
        const sd = await sRes.json();
        setSenders(sd.senders || []);
        for (const s of sd.senders || []) {
          if (s.purpose !== 'gmail') {
            accs.push({ id: s.id, label: s.label || 'Resend', address: s.address, provider: 'resend', connected: true });
          }
        }
      }
    } catch { /* skip */ }
    setAccounts(accs);
    if (accs.length === 0) {
      setAccounts([{ id: 'platform', label: 'Platform', address: '', provider: 'platform', connected: true }]);
      setActiveAccount('platform');
    } else {
      setActiveAccount((prev) => (prev && accs.some((a) => a.id === prev) ? prev : accs[0].id));
    }
  }, []);

  // ── Load emails ────────────────────────────────────────────────────────────
  const loadEmails = useCallback(async () => {
    setLoadingList(true);
    try {
      const endpoint =
        folder === 'sent'
          ? '/api/mail/sent'
          : folder === 'outbound'
            ? '/api/mail/outbound'
            : `/api/mail/${folder}`;
      const params = new URLSearchParams();
      if (folder !== 'outbound' && activeAccount && activeAccount !== 'all' && activeAccount !== 'platform') {
        const acctVal = activeAccount.startsWith('gmail:') ? activeAccount.slice(6) : activeAccount;
        if (acctVal) params.set('account', acctVal);
      }
      const tokens = gmailPageTokensRef.current;
      const src = listSourceRef.current;
      if (listPage > 1 && tokens[listPage]) {
        params.set('page_token', tokens[listPage]);
      } else if (listPage > 1 && src !== 'gmail' && folder !== 'outbound') {
        params.set('page', String(listPage));
      }
      const url = params.toString() ? `${endpoint}?${params}` : endpoint;
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const list: Email[] = (data.emails || []).map((e: Email) => ({
        ...e,
        date_received: e.date_received || (e as Email & { created_at?: string }).created_at || '',
      }));
      setEmails(list);
      setListTotal(data.total ?? list.length);
      setListPageSize(data.page_size ?? 50);
      const nextSource = data.source === 'gmail' ? 'gmail' : data.source === 'outbox' ? 'outbox' : 'd1';
      listSourceRef.current = nextSource;
      setListSource(nextSource);
      if (data.next_page_token) {
        setGmailPageTokens((prev) => {
          if (prev[listPage + 1] === data.next_page_token) return prev;
          const next = { ...prev, [listPage + 1]: data.next_page_token };
          gmailPageTokensRef.current = next;
          return next;
        });
      }
      setStats((s) => ({ ...s, total: data.total ?? list.length, unread: data.unread_count ?? s.unread }));
    } catch {
      setEmails([]);
    } finally {
      setLoadingList(false);
    }
  }, [folder, activeAccount, listPage]);

  const loadStats = useCallback(async () => {
    if (folder === 'outbound') return;
    try {
      const res = await fetch(`/api/mail/stats${accountQuery(activeAccount)}`, { credentials: 'same-origin' });
      if (res.ok) {
        const d = await res.json();
        setStats({ total: d.total, unread: d.unread, starred: d.starred });
      }
    } catch {
      /* skip */
    }
  }, [activeAccount, folder]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);
  useEffect(() => {
    setListPage(1);
    setGmailPageTokens({});
    gmailPageTokensRef.current = {};
    setListSource('');
    listSourceRef.current = '';
    setSelectedIds(new Set());
  }, [folder, activeAccount]);
  // Clear open pane only when the list context changes — not when loadEmails identity churns.
  useEffect(() => {
    setSelected(null);
    setDetail(null);
    setSelectedIds(new Set());
  }, [folder, activeAccount, listPage]);
  useEffect(() => {
    void loadEmails();
    void loadStats();
  }, [loadEmails, loadStats]);

  // ── Load email detail ──────────────────────────────────────────────────────
  const openEmail = useCallback(
    async (email: Email) => {
      setSelected(email);
      setDetail(null);
      setLoadingDetail(true);
      try {
        if (folder === 'outbound' || email.account === 'outbound') {
          const body =
            email._outbox?.body_text ||
            [
              `Status: ${email._outbox?.status || '—'}`,
              `To: ${email.to_address || '—'}`,
              `Channel: ${email.category || '—'}`,
              email._outbox?.event_type ? `Event: ${email._outbox.event_type}` : null,
              email._outbox?.last_error ? `Error: ${email._outbox.last_error}` : null,
            ]
              .filter(Boolean)
              .join('\n');
          setDetail({ email, body, attachments: [], thread: [] });
          return;
        }
        const acctQs = email.account ? `?account=${encodeURIComponent(email.account)}` : accountQuery(activeAccount);
        const res = await fetch(`/api/mail/email/${encodeURIComponent(email.id)}${acctQs}`, {
          credentials: 'same-origin',
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const d = await res.json();
        setDetail(d);
        if (!email.is_read) {
          setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, is_read: 1 } : e)));
          const patchAcct =
            email.account || (activeAccount !== 'all' ? activeAccount.replace(/^gmail:/, '') : '');
          fetch(`/api/mail/email/${encodeURIComponent(email.id)}`, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_read: 1, ...(patchAcct ? { account: patchAcct } : {}) }),
          }).catch(() => {});
        }
      } catch {
        /* show empty detail */
      } finally {
        setLoadingDetail(false);
      }
    },
    [activeAccount, folder],
  );

  // Deep link folder — only apply when query present and value actually changes.
  useEffect(() => {
    const folderParam = String(searchParams.get('folder') || '').trim().toLowerCase();
    if (
      folderParam === 'inbox' ||
      folderParam === 'sent' ||
      folderParam === 'outbound' ||
      folderParam === 'starred' ||
      folderParam === 'archived'
    ) {
      setFolder((prev) => (prev === folderParam ? prev : (folderParam as Folder)));
    }
  }, [searchParams]);

  // Deep link: /dashboard/mail?email=<id> → open that message in-app.
  useEffect(() => {
    const emailId = String(searchParams.get('email') || '').trim();
    if (!emailId || loadingList) return;
    if (deepLinkEmailHandled.current === emailId) return;

    const match = emails.find((e) => e.id === emailId);
    if (match) {
      deepLinkEmailHandled.current = emailId;
      void openEmail(match);
      return;
    }

    // Not in current page — fetch by id so push/inbox deep links still land.
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/mail/email/${encodeURIComponent(emailId)}`, {
          credentials: 'same-origin',
        });
        if (!res.ok || cancelled) return;
        const d = await res.json();
        const email = (d?.email || d) as Email | null;
        if (!email?.id || cancelled) return;
        deepLinkEmailHandled.current = emailId;
        await openEmail({
          ...email,
          id: String(email.id),
          subject: email.subject || '',
          from_address: email.from_address || '',
          to_address: email.to_address || '',
          is_read: email.is_read ?? 0,
          is_starred: email.is_starred ?? 0,
          is_archived: email.is_archived ?? 0,
          date_received: email.date_received || '',
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, emails, loadingList, openEmail]);

  // Deep link: /dashboard/mail?c=<conversationId> (phone-loop) → resolve sent mail by ref.
  useEffect(() => {
    const emailId = String(searchParams.get('email') || '').trim();
    const convId = String(searchParams.get('c') || searchParams.get('conversation') || '')
      .trim()
      .replace(/^as_/i, '');
    if (!convId || emailId || loadingList) return;
    if (deepLinkConvHandled.current === convId) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/mail/by-ref?c=${encodeURIComponent(convId)}`, {
          credentials: 'same-origin',
        });
        if (!res.ok || cancelled) return;
        const d = await res.json();
        const email = d?.email as Email | null;
        if (!email?.id || cancelled) return;
        deepLinkConvHandled.current = convId;
        setFolder('sent');
        await openEmail({
          ...email,
          id: String(email.id),
          subject: email.subject || '',
          from_address: email.from_address || '',
          to_address: email.to_address || '',
          is_read: email.is_read ?? 0,
          is_starred: email.is_starred ?? 0,
          is_archived: email.is_archived ?? 0,
          date_received: email.date_received || '',
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, loadingList, openEmail]);

  const mailNextSteps = useMemo(() => {
    const parsed = parseMailNextSteps(detail?.body || '');
    const fromQuery = String(searchParams.get('c') || '').trim().replace(/^as_/i, '');
    return {
      conversationId: parsed.conversationId || fromQuery || null,
      steps: parsed.steps,
    };
  }, [detail?.body, searchParams]);

  const runMailNextStep = useCallback(
    async (step: { action: string; label: string; instruction: string }) => {
      const conversationId = mailNextSteps.conversationId;
      if (!conversationId || !step.instruction) return;
      setNextStepBusy(step.action);
      setNextStepMsg(null);
      try {
        const res = await fetch('/api/mail/agent-continue', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId,
            instruction: step.instruction,
            action: step.action,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !(data?.ok || data?.accepted)) {
          setNextStepMsg(String(data?.error || 'Could not start Agent Sam turn'));
          return;
        }
        setNextStepMsg(`Agent Sam is working on “${step.label}” — watch email / push for the result.`);
      } catch (e) {
        setNextStepMsg(e instanceof Error ? e.message : 'Request failed');
      } finally {
        setNextStepBusy(null);
      }
    },
    [mailNextSteps.conversationId],
  );

  // ── CRUD ops ───────────────────────────────────────────────────────────────
  const patchEmail = useCallback(async (id: string, patch: Partial<Email>, account?: string) => {
    setEmails(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
    if (selected?.id === id) setSelected(s => s ? { ...s, ...patch } : s);
    const acct = account || selected?.account || '';
    await fetch(`/api/mail/email/${encodeURIComponent(id)}`, {
      method: 'PATCH', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, ...(acct ? { account: acct } : {}) }),
    }).catch(() => {});
  }, [selected]);

  const archiveEmail = useCallback(async (email: Email) => {
    if (folder === 'outbound' || email.account === 'outbound') return;
    await patchEmail(email.id, { is_archived: 1 }, email.account);
    setEmails(prev => prev.filter(e => e.id !== email.id));
    if (selected?.id === email.id) { setSelected(null); setDetail(null); }
  }, [patchEmail, selected, folder]);

  const deleteEmail = useCallback(async (email: Email) => {
    if (folder === 'outbound' || email.account === 'outbound') return;
    const acctQs = email.account
      ? `?account=${encodeURIComponent(email.account)}`
      : accountQuery(activeAccount);
    await fetch(`/api/mail/email/${encodeURIComponent(email.id)}${acctQs}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
    setEmails(prev => prev.filter(e => e.id !== email.id));
    if (selected?.id === email.id) { setSelected(null); setDetail(null); }
  }, [selected, activeAccount, folder]);

  const toggleStar = useCallback((email: Email) => {
    if (folder === 'outbound') return;
    patchEmail(email.id, { is_starred: email.is_starred ? 0 : 1 }, email.account);
  }, [patchEmail, folder]);

  // ── Send ───────────────────────────────────────────────────────────────────
  const sendEmail = useCallback(async () => {
    const to = String(compose.to || '').trim();
    const subject = String(compose.subject || '').trim();
    const body = String(compose.body ?? '');
    const from = String(compose.from || '').trim();
    if (!to || !subject) {
      setSendResult({ ok: false, msg: 'To and Subject required' });
      return;
    }
    setSending(true);
    setSendResult(null);
    try {
      const fromLower = from.toLowerCase();
      const provider =
        fromLower.includes('@gmail') || fromLower.includes('gmail:') ? 'gmail' : 'resend';
      const res = await fetch('/api/mail/send', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          from: from || undefined,
          to,
          subject,
          html: body.includes('<')
            ? body
            : `<p>${body.replace(/\n/g, '<br>')}</p>`,
          text: body,
          in_reply_to: compose.in_reply_to || undefined,
          thread_id: compose.thread_id || undefined,
        }),
      });
      let d: { ok?: boolean; error?: string; provider?: string } = {};
      try {
        d = await res.json();
      } catch {
        throw new Error(`Send failed (HTTP ${res.status})`);
      }
      if (!res.ok || !d.ok) throw new Error(String(d.error || `Send failed (HTTP ${res.status})`));
      setSendResult({ ok: true, msg: `Sent via ${d.provider || provider}` });
      window.setTimeout(() => {
        setComposing(false);
        setSendResult(null);
        setCompose((c) => ({
          ...c,
          to: '',
          subject: '',
          body: '',
          in_reply_to: '',
          thread_id: '',
        }));
      }, 1800);
    } catch (e: unknown) {
      setSendResult({ ok: false, msg: String((e as Error)?.message || e || 'Send failed') });
    } finally {
      setSending(false);
    }
  }, [compose]);

  // ── Draft reply shortcut ───────────────────────────────────────────────────
  const startReply = useCallback((email: Email, d: EmailDetail | null) => {
    const meta = d?.email?.metadata as Record<string, string> | undefined;
    setCompose(c => ({
      ...c,
      to: email.from_address,
      subject: email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
      body: '',
      in_reply_to: meta?.message_id || '',
      thread_id: meta?.thread_id || '',
    }));
    setComposing(true);
  }, []);

  // ── Panel resize (desktop only) ────────────────────────────────────────────
  const startResize = useCallback((panel: 'sidebar' | 'detail', e: React.PointerEvent) => {
    if (isMobile) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    resizingRef.current = { panel, startX: e.clientX, startW: panel === 'sidebar' ? sidebarW : detailW };
  }, [isMobile, sidebarW, detailW]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      const dx = e.clientX - r.startX;
      if (r.panel === 'sidebar') {
        const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, r.startW + dx));
        setSidebarW(w);
        try { localStorage.setItem('mail_sidebar_w', String(w)); } catch {}
      } else {
        const w = Math.min(DETAIL_MAX, Math.max(DETAIL_MIN, r.startW - dx));
        setDetailW(w);
        try { localStorage.setItem('mail_detail_w', String(w)); } catch {}
      }
    };
    const up = () => { resizingRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  // ── Filtered email list ────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return q ? emails.filter(e =>
      e.from_address.toLowerCase().includes(q) ||
      e.subject.toLowerCase().includes(q) ||
      (e.to_address || '').toLowerCase().includes(q)
    ) : emails;
  }, [emails, search]);

  const toggleSelectId = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelectedIds(new Set(filtered.map((e) => e.id)));
  }, [filtered]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const bulkArchive = useCallback(async () => {
    if (folder === 'outbound' || selectedIds.size === 0) return;
    const targets = emails.filter((e) => selectedIds.has(e.id));
    for (const email of targets) {
      await archiveEmail(email);
    }
    setSelectedIds(new Set());
  }, [folder, selectedIds, emails, archiveEmail]);

  const bulkDelete = useCallback(async () => {
    if (folder === 'outbound' || selectedIds.size === 0) return;
    const targets = emails.filter((e) => selectedIds.has(e.id));
    for (const email of targets) {
      await deleteEmail(email);
    }
    setSelectedIds(new Set());
  }, [folder, selectedIds, emails, deleteEmail]);

  const sidebarProps = {
    accounts, activeAccount, setActiveAccount,
    folder, setFolder, stats,
    loadEmails, loadStats,
    setComposing, setCompose,
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <CollaborateWorkShell surface="mail" onMenuTap={isMobile ? () => setDrawerOpen(true) : undefined}>
    <div className={`mail-work-surface${insightsOpen ? ' insights-open' : ''}`}>

      {/* ── MOBILE DRAWER ───────────────────────────────────────────────── */}
      {isMobile && (
        <>
          <div
            className={`mail-sidebar-drawer-overlay${drawerOpen ? ' open' : ''}`}
            onClick={() => setDrawerOpen(false)}
          />
          <div className={`mail-sidebar-drawer${drawerOpen ? ' open' : ''}`} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <SidebarContent {...sidebarProps} onClose={() => setDrawerOpen(false)} />
          </div>
        </>
      )}

    <div className="mail-work-surface-main">

      {/* ── LEFT SIDEBAR (desktop only) ──────────────────────────────────── */}
      {!isMobile && (
        <>
          <div className="mail-sidebar" style={{ width: sidebarW, minWidth: SIDEBAR_MIN, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <SidebarContent {...sidebarProps} />
          </div>
          {/* Sidebar resize handle */}
          <div className="mail-sidebar-resize" onPointerDown={e => startResize('sidebar', e)} style={{ width: 5, flexShrink: 0, cursor: 'col-resize', background: 'transparent', borderRight: '1px solid var(--border-subtle)' }} />
        </>
      )}

      {/* ── CENTER LIST ─────────────────────────────────────────────────── */}
      <div className="mail-list-pane" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <>
        {/* Toolbar */}
        <div className="mail-list-toolbar" style={{ height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
          <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 0.1, textTransform: 'capitalize' }}>
            {folder === 'outbound' ? 'Outbound' : folder}
          </span>
          {folder !== 'outbound' ? (
            <>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selectedIds.size === filtered.length}
                  onChange={(e) => (e.target.checked ? selectAllFiltered() : clearSelection())}
                />
                All
              </label>
              {selectedIds.size > 0 ? (
                <>
                  <Btn onClick={() => void bulkArchive()} small title="Archive selected">
                    <Archive size={12} />Archive ({selectedIds.size})
                  </Btn>
                  <Btn onClick={() => void bulkDelete()} small danger title="Delete selected">
                    <Trash2 size={12} />Delete
                  </Btn>
                  <Btn onClick={clearSelection} small>Clear</Btn>
                </>
              ) : null}
            </>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Platform digests & system email queue</span>
          )}
          <Btn onClick={handleMailAgent} small title="Open mail assistant in Agent Sam"><Bot size={12} />Triage</Btn>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              title="Previous page"
              disabled={listPage <= 1 || loadingList}
              onClick={() => setListPage((p) => Math.max(1, p - 1))}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: listPage <= 1 ? 'var(--text-muted)' : 'var(--text-main)', cursor: listPage <= 1 ? 'not-allowed' : 'pointer', opacity: listPage <= 1 ? 0.5 : 1 }}
            >
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 60, textAlign: 'center' }}>
              {listTotal > 0
                ? `${(listPage - 1) * listPageSize + 1}–${Math.min(listPage * listPageSize, listTotal)} of ${listTotal}`
                : `Page ${listPage}`}
            </span>
            <button
              type="button"
              title="Next page"
              disabled={loadingList || (listSource === 'gmail' ? !gmailPageTokens[listPage + 1] : listPage * listPageSize >= listTotal)}
              onClick={() => setListPage((p) => p + 1)}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-main)', cursor: 'pointer', opacity: (listSource === 'gmail' ? !gmailPageTokens[listPage + 1] : listPage * listPageSize >= listTotal) ? 0.5 : 1 }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ width: '100%', height: 30, padding: '0 9px 0 28px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, color: 'var(--text-main)', fontSize: 12, outline: 'none' }} />
          </div>
          {loadingList && <RefreshCw size={13} style={{ color: 'var(--text-muted)', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />}
        </div>

        {/* Email list */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: isMobile ? 56 : 0 }}>
          {filtered.length === 0 && !loadingList && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No messages</div>
          )}
          {filtered.map(email => (
            <div key={email.id} onClick={() => openEmail(email)} className={`mail-list-row${selected?.id === email.id ? ' is-selected' : ''}${selectedIds.has(email.id) ? ' is-checked' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', transition: 'background 0.1s' }}>
              {folder !== 'outbound' ? (
                <input
                  type="checkbox"
                  checked={selectedIds.has(email.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelectId(email.id)}
                  title="Select"
                  style={{ flexShrink: 0 }}
                />
              ) : null}
              {/* Avatar */}
              <div style={{ width: 34, height: 34, borderRadius: 99, background: avatarColor(email.from_address), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#000', flexShrink: 0 }}>
                {initials(email.from_address)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: email.is_read ? 500 : 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{email.from_address.split('<')[0].trim() || email.from_address}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{fmtDate(email.date_received)}</span>
                </div>
                <div style={{ fontSize: 11, fontWeight: email.is_read ? 400 : 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: email.is_read ? 'var(--text-muted)' : 'var(--text-main)', marginBottom: 2 }}>{email.subject || '(no subject)'}</div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {!email.is_read && <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--solar-cyan)' }} />}
                  {email.is_starred === 1 && <Star size={10} style={{ color: 'var(--solar-yellow)', fill: 'var(--solar-yellow)' }} />}
                  {email.has_attachments === 1 && <Paperclip size={10} style={{ color: 'var(--text-muted)' }} />}
                  {email.category && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 99, background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>{email.category}</span>}
                </div>
              </div>
              {/* Row actions */}
              <div style={{ display: 'flex', gap: 3, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                <button type="button" title="Star" onClick={() => toggleStar(email)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: email.is_starred ? 'var(--solar-yellow)' : 'var(--text-muted)', padding: 3, borderRadius: 5 }}>
                  <Star size={13} style={{ fill: email.is_starred ? 'var(--solar-yellow)' : 'none' }} />
                </button>
                <button type="button" title="Archive" onClick={() => archiveEmail(email)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 3, borderRadius: 5 }}>
                  <Archive size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
        </>
      </div>

      {/* ── DETAIL PANEL ───────────────────────────────────────────────── */}
      {selected && (
        <>
          {/* Detail resize handle (desktop only) */}
          {!isMobile && (
            <div onPointerDown={e => startResize('detail', e)} style={{ width: 5, flexShrink: 0, cursor: 'col-resize', background: 'transparent', borderLeft: '1px solid var(--border-subtle)' }} />
          )}

          <div className="mail-detail-pane" style={isMobile ? {} : { width: detailW, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Detail header */}
            <div style={{ height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', borderBottom: '1px solid var(--border-subtle)' }}>
              <button type="button" onClick={() => { setSelected(null); setDetail(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6 }}><ChevronLeft size={16} /></button>
              <div style={{ flex: 1 }} />
              <Btn onClick={() => startReply(selected, detail)} small><Reply size={12} />Reply</Btn>
              {!isMobile && <Btn onClick={() => { setCompose(c => ({ ...c, to: '', subject: `Fwd: ${selected.subject}`, body: detail?.body ? `\n\n--- Forwarded ---\n${detail.body}` : '' })); setComposing(true); }} small><Forward size={12} />Fwd</Btn>}
              <Btn onClick={() => toggleStar(selected)} small active={selected.is_starred === 1}><Star size={12} style={{ fill: selected.is_starred ? 'var(--solar-yellow)' : 'none', color: selected.is_starred ? 'var(--solar-yellow)' : undefined }} /></Btn>
              <Btn onClick={() => archiveEmail(selected)} small><Archive size={12} /></Btn>
              <Btn onClick={() => deleteEmail(selected)} small danger><Trash2 size={12} /></Btn>
              <Btn onClick={handleMailAgent} small><Bot size={12} />Agent</Btn>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', paddingBottom: isMobile ? 56 : 0 }}>
              {/* Subject */}
              <div style={{ padding: '16px 18px 10px' }}>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8, lineHeight: 1.35 }}>{selected.subject || '(no subject)'}</div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{selected.from_address}</span>
                  <span>→ {selected.to_address || 'me'}</span>
                  <span style={{ marginLeft: 'auto' }}>{fmtDate(selected.date_received)}</span>
                </div>
              </div>

              {/* Body */}
              {loadingDetail && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>
              )}
              {detail && (
                <div style={{ padding: '0 18px 18px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  {mailNextSteps.steps.length > 0 && mailNextSteps.conversationId ? (
                    <div
                      style={{
                        marginBottom: 14,
                        padding: 12,
                        borderRadius: 10,
                        border: '1px solid var(--border-subtle)',
                        background: 'rgba(0, 255, 200, 0.06)',
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.04, marginBottom: 8, color: 'var(--text-muted)' }}>
                        Agent Sam — next steps
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {mailNextSteps.steps.map((step) => (
                          <button
                            key={step.action}
                            type="button"
                            disabled={!!nextStepBusy}
                            onClick={() => void runMailNextStep(step)}
                            style={{
                              height: 32,
                              padding: '0 12px',
                              borderRadius: 8,
                              border: '1px solid var(--border-subtle)',
                              background: 'var(--bg-elevated)',
                              color: 'var(--text-main)',
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: nextStepBusy ? 'wait' : 'pointer',
                              opacity: nextStepBusy && nextStepBusy !== step.action ? 0.55 : 1,
                            }}
                          >
                            {nextStepBusy === step.action ? 'Starting…' : step.label}
                          </button>
                        ))}
                      </div>
                      {nextStepMsg ? (
                        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                          {nextStepMsg}
                        </div>
                      ) : (
                        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                          Or reply to this email — keep the [ref:as_…] token so the thread stays bound.
                        </div>
                      )}
                    </div>
                  ) : null}
                  {detail.body ? (
                    isHtml(detail.body) ? (
                      <EmailHtmlPreview html={stripMailNextStepsPayload(detail.body)} />
                    ) : (
                      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.7, color: 'var(--text-main)', margin: 0, flex: 1 }}>
                        {stripMailNextStepsPayload(detail.body)}
                      </pre>
                    )
                  ) : (
                    <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '12px 0' }}>No body content</div>
                  )}

                  {/* Attachments */}
                  {detail.attachments.length > 0 && (
                    <div style={{ marginTop: 16, flexShrink: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>Attachments ({detail.attachments.length})</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {detail.attachments.map(att => (
                          <a
                            key={att.id}
                            href={`/api/mail/attachment/${encodeURIComponent(selected.id)}/${encodeURIComponent(att.id)}${selected.account ? `?account=${encodeURIComponent(selected.account)}` : ''}`}
                            download={att.filename}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 11, color: 'var(--text-main)', textDecoration: 'none' }}
                          >
                            <Paperclip size={11} />
                            <span>{att.filename}</span>
                            <span style={{ color: 'var(--text-muted)' }}>{fmtSize(att.size)}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Thread */}
                  {detail.thread.length > 1 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>Thread ({detail.thread.length})</div>
                      {detail.thread.filter(t => t.id !== selected.id).map(t => (
                        <div key={t.id} style={{ padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border-subtle)', marginBottom: 6, fontSize: 11 }}>
                          <div style={{ fontWeight: 700, marginBottom: 2 }}>{t.from_address}</div>
                          <div style={{ color: 'var(--text-muted)' }}>{t.subject} · {fmtDate(t.date_received)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

    </div>

      {insightsOpen ? (
        <div className="mail-time-insights-rail">
          <MailTimeInsightsPanel />
        </div>
      ) : null}

      {!isMobile && (
        <CollaboratePageRail
          activeSurface="mail"
          insightsOpen={insightsOpen}
          onInsightsToggle={() => setInsightsOpen((v) => !v)}
          onTasksClick={() => navigate('/dashboard/collaborate?seg=tickets')}
          onMailAgentClick={handleMailAgent}
        />
      )}

      {/* ── COMPOSE MODAL ──────────────────────────────────────────────── */}
      {composing && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: isMobile ? 'stretch' : 'flex-end', padding: isMobile ? 0 : 24, pointerEvents: 'none' }}>
          <div style={{ width: isMobile ? '100%' : 520, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: isMobile ? '14px 14px 0 0' : 14, boxShadow: '0 8px 40px rgba(0,0,0,0.5)', overflow: 'hidden', pointerEvents: 'all', display: 'flex', flexDirection: 'column', maxHeight: isMobile ? '90vh' : 'unset', paddingBottom: isMobile ? 56 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'rgba(0,255,200,0.04)' }}>
              <span style={{ fontSize: 13, fontWeight: 800, flex: 1 }}>New Message</span>
              <button type="button" onClick={() => setComposing(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={16} /></button>
            </div>
            <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 48, flexShrink: 0 }}>From</span>
                <select value={compose.from} onChange={e => setCompose(c => ({ ...c, from: e.target.value }))} style={{ flex: 1, height: 28, background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 7, color: 'var(--text-main)', fontSize: 12, padding: '0 8px' }}>
                  <option value="">Platform default</option>
                  {senders.map(s => <option key={s.id} value={s.address}>{s.label ? `${s.label} <${s.address}>` : s.address}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 48, flexShrink: 0 }}>To</span>
                <input value={compose.to} onChange={e => setCompose(c => ({ ...c, to: e.target.value }))} placeholder="recipient@example.com" style={{ flex: 1, height: 28, background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 7, color: 'var(--text-main)', fontSize: 12, padding: '0 8px', outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 48, flexShrink: 0 }}>Subject</span>
                <input value={compose.subject} onChange={e => setCompose(c => ({ ...c, subject: e.target.value }))} placeholder="Subject" style={{ flex: 1, height: 28, background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 7, color: 'var(--text-main)', fontSize: 12, padding: '0 8px', outline: 'none' }} />
              </div>
              <textarea value={compose.body} onChange={e => setCompose(c => ({ ...c, body: e.target.value }))} placeholder="Write your message…" rows={isMobile ? 8 : 10} style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 7, color: 'var(--text-main)', fontSize: 12, padding: '10px', resize: 'vertical', outline: 'none', fontFamily: 'var(--font-sans)', lineHeight: 1.6 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--border-subtle)' }}>
              {sendResult && (
                <span style={{ fontSize: 11, color: sendResult.ok ? 'var(--solar-cyan)' : '#ef4444', flex: 1 }}>
                  {sendResult.ok ? <CheckCircle size={11} style={{ display: 'inline', marginRight: 4 }} /> : <AlertTriangle size={11} style={{ display: 'inline', marginRight: 4 }} />}
                  {sendResult.msg}
                </span>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <Btn onClick={() => setComposing(false)} small>Cancel</Btn>
                <Btn onClick={sendEmail} small active>{sending ? 'Sending…' : <><Send size={12} />Send</>}</Btn>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
      `}</style>
    </div>
    </CollaborateWorkShell>
  );
}

export default MailPage;
