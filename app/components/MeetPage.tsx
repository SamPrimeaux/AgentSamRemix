/**
 * app/dashboard/components/MeetPage.tsx
 * InnerAnimalMedia Meet — RealtimeKit (v2) or legacy Cloudflare Calls SFU
 * Fully theme-variable-driven. No hardcoded colors.
 */

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import {
  Mic, MicOff, Camera, CameraOff, MonitorUp, ScreenShareOff,
  PhoneOff, MessageSquare, Users, Sparkles, Copy, Send,
  Loader2, Radio, Video, Mail, Plus, ChevronDown,
  FileText, CheckSquare, AlignLeft, Circle, Settings,
  BarChart2, Pin,
  Maximize2, Volume2, VolumeX, Bot,
} from 'lucide-react';
import { MeetCtxValue } from '../src/MeetContext';

// ── Types ──────────────────────────────────────────────────────────────────

interface Participant {
  user_id: string;
  display_name: string;
  session_id: string;
  tracks: string[];
  stream?: MediaStream;
  audioMuted?: boolean;
  videoMuted?: boolean;
  isSpeaking?: boolean;
}

interface ChatMessage {
  id: string;
  user_id: string;
  display_name: string;
  content: string;
  created_at: string;
  isAi?: boolean;
}

interface PollOption { label: string; votes: number; }
interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  live: boolean;
}

type CallPhase  = 'lobby' | 'connecting' | 'in-call' | 'ended';
type RightTab   = 'chat' | 'ai';
type AiStudioItem = 'summary' | 'takeaways' | 'actions' | 'transcript' | 'recording';

// ── API util ───────────────────────────────────────────────────────────────

function api(path: string, opts: RequestInit = {}) {
  return fetch(`/api/meet${path}`, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

function fmtTime(s: string) {
  try { return new Date(s + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function useCallTimer(active: boolean) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!active) { setSec(0); return; }
    const id = setInterval(() => setSec(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
}

// ── Video Tile ─────────────────────────────────────────────────────────────

function VideoTile({ p, stream, isSelf, pinned, onPin }: {
  p: Participant; stream?: MediaStream;
  isSelf: boolean; pinned: boolean; onPin: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current && stream) ref.current.srcObject = stream; }, [stream]);
  const initials = p.display_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const hasVideo = (stream?.getVideoTracks().length ?? 0) > 0;

  return (
    <div className={`vtile ${pinned ? 'vtile-pinned' : ''} ${p.isSpeaking ? 'vtile-speaking' : ''}`}>
      {hasVideo
        ? <video ref={ref} autoPlay playsInline muted={isSelf} className="vtile-video" />
        : <div className="vtile-avatar"><span>{initials}</span></div>
      }
      <div className="vtile-bar">
        <div className="vtile-bar-left">
          {p.audioMuted
            ? <MicOff size={12} className="vtile-icon-off" />
            : <Volume2 size={12} className={`vtile-icon-on ${p.isSpeaking ? 'speaking' : ''}`} />
          }
          <span className="vtile-name">{p.display_name}{isSelf ? ' (You)' : ''}</span>
          {p.videoMuted && <CameraOff size={12} className="vtile-icon-off" />}
        </div>
        <button className="vtile-pin-btn" onClick={e => { e.stopPropagation(); onPin(); }} title={pinned ? 'Unpin' : 'Pin'}>
          <Pin size={11} className={pinned ? 'pinned' : ''} />
        </button>
      </div>
    </div>
  );
}

// ── Invite Modal ───────────────────────────────────────────────────────────

function InviteModal({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const link = `${window.location.origin}/dashboard/meet?room=${roomId}`;

  const send = async () => {
    if (!email.trim()) return;
    setSending(true);
    await api(`/room/${roomId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ email: email.trim(), link }),
    }).catch(() => {});
    setSent(true);
    setSending(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title"><Mail size={15} /> Invite to meeting</h3>
        <p className="modal-sub">Share link or send email invite via Resend.</p>
        <div className="modal-link-row">
          <span className="modal-link-val">{link.replace('https://', '')}</span>
          <button className="modal-copy-btn" onClick={() => navigator.clipboard.writeText(link)}>
            <Copy size={12} /> Copy
          </button>
        </div>
        {!sent ? (
          <>
            <input className="modal-input" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="colleague@example.com" onKeyDown={e => e.key === 'Enter' && send()} />
            <button className="modal-send-btn" onClick={send} disabled={!email.trim() || sending}>
              {sending ? <><Loader2 size={13} className="spin" /> Sending…</> : <><Send size={13} /> Send invite</>}
            </button>
          </>
        ) : (
          <div className="modal-sent">✓ Invite sent to {email}</div>
        )}
        <button className="modal-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ── Poll Panel ─────────────────────────────────────────────────────────────

function PollPanel() {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);

  const addPoll = () => {
    if (!q.trim() || opts.filter(o => o.trim()).length < 2) return;
    setPolls(prev => [...prev, {
      id: crypto.randomUUID(), question: q.trim(),
      options: opts.filter(o => o.trim()).map(label => ({ label, votes: 0 })),
      live: true,
    }]);
    setQ(''); setOpts(['', '']); setCreating(false);
  };

  const vote = (pollId: string, idx: number) => {
    setPolls(prev => prev.map(p => p.id !== pollId ? p : {
      ...p, options: p.options.map((o, i) => i === idx ? { ...o, votes: o.votes + 1 } : o),
    }));
  };

  return (
    <div className="poll-panel">
      {polls.map(poll => {
        const total = poll.options.reduce((s, o) => s + o.votes, 0);
        return (
          <div key={poll.id} className="poll-card">
            <div className="poll-header">
              <span className="poll-q">{poll.question}</span>
              {poll.live && <span className="poll-live">Live</span>}
            </div>
            {poll.options.map((opt, i) => (
              <button key={i} className="poll-opt" onClick={() => vote(poll.id, i)}>
                <div className="poll-opt-bar" style={{ width: total ? `${(opt.votes / total) * 100}%` : '0%' }} />
                <span className="poll-opt-label">{opt.label}</span>
                <span className="poll-opt-votes">{opt.votes}</span>
              </button>
            ))}
            <div className="poll-total">{total} votes</div>
          </div>
        );
      })}
      {creating ? (
        <div className="poll-create">
          <input className="poll-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Poll question…" />
          {opts.map((o, i) => (
            <input key={i} className="poll-input" value={o}
              onChange={e => setOpts(prev => prev.map((v, j) => j === i ? e.target.value : v))}
              placeholder={`Option ${i + 1}`} />
          ))}
          <button className="poll-add-opt" onClick={() => setOpts(prev => [...prev, ''])}>
            <Plus size={11} /> Add option
          </button>
          <div className="poll-create-actions">
            <button className="poll-cancel" onClick={() => setCreating(false)}>Cancel</button>
            <button className="poll-submit" onClick={addPoll}>Launch poll</button>
          </div>
        </div>
      ) : (
        <button className="tool-row" onClick={() => setCreating(true)}>
          <Plus size={13} /><span>New poll</span>
        </button>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────

const MeetRealtimeKitShell = lazy(() => import('./MeetRealtimeKitShell'));

function useMeetEngine(): 'loading' | 'legacy' | 'realtimekit' {
  const [mode, setMode] = useState<'loading' | 'legacy' | 'realtimekit'>('loading');
  useEffect(() => {
    fetch('/api/config/client', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { meetEngine?: string }) => {
        setMode(d?.meetEngine === 'realtimekit' ? 'realtimekit' : 'legacy');
      })
      .catch(() => setMode('legacy'));
  }, []);
  return mode;
}

export default function MeetPage(props: { onContextReady?: (ctx: MeetCtxValue) => void }) {
  const engine = useMeetEngine();
  if (engine === 'loading') {
    return (
      <>
        <MeetCSS />
        <div className="lobby-wrap"><Loader2 size={24} className="spin" /></div>
      </>
    );
  }
  if (engine === 'realtimekit') {
    return (
      <>
        <MeetCSS />
        <Suspense fallback={<div className="lobby-wrap"><Loader2 size={24} className="spin" /></div>}>
          <MeetRealtimeKitShell {...props} />
        </Suspense>
      </>
    );
  }
  return <MeetLegacyPage {...props} />;
}

function MeetLegacyPage({ onContextReady }: { onContextReady?: (ctx: MeetCtxValue) => void }) {
  /** When present on first paint, lobby form is skipped and join runs automatically. */
  const [roomFromUrl] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('room')?.trim() || '';
  });

  const [phase, setPhase]         = useState<CallPhase>(() => (roomFromUrl ? 'connecting' : 'lobby'));
  const [roomId, setRoomId]       = useState('');
  const [roomName, setRoomName]   = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError]         = useState<string | null>(null);

  const [audioOn, setAudioOn]     = useState(true);
  const [videoOn, setVideoOn]     = useState(true);
  const [screenOn, setScreenOn]   = useState(false);
  const [recording, setRecording] = useState(false);
  const [screenStreamState, setScreenStreamState] = useState<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunks = useRef<Blob[]>([]);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [aiInput, setAiInput]     = useState('');
  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  const [rightTab, setRightTab]   = useState<RightTab>('chat');
  const [unread, setUnread]       = useState(0);
  const [pinnedId, setPinnedId]   = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showPoll, setShowPoll]   = useState(false);
  const [showNewMeetingMenu, setShowNewMeetingMenu] = useState(false);
  const [newMeetLink, setNewMeetLink] = useState<string | null>(null);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleDuration, setScheduleDuration] = useState(60);
  const [scheduleEmails, setScheduleEmails] = useState('');
  const [scheduleDesc, setScheduleDesc] = useState('');
  const [scheduleMsg, setScheduleMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [copyLinkFeedback, setCopyLinkFeedback] = useState(false);
  const [aiStudioOpen, setAiStudioOpen] = useState<AiStudioItem | null>(null);
  const [aiStudioResult, setAiStudioResult] = useState<string | null>(null);

  // WebRTC refs
  const pcRef           = useRef<RTCPeerConnection | null>(null);
  const localRef        = useRef<MediaStream | null>(null);
  const screenRef       = useRef<MediaStream | null>(null);
  const sessionRef      = useRef<string | null>(null);
  const iceRef          = useRef<RTCIceServer[]>([]);
  const pollTimer       = useRef<number | null>(null);
  const hbTimer         = useRef<number | null>(null);
  const meetVisCleanup  = useRef<(() => void) | null>(null);
  const knownSessions   = useRef<Set<string>>(new Set());
  const remoteStreams    = useRef<Map<string, MediaStream>>(new Map());
  const chatEnd         = useRef<HTMLDivElement>(null);
  const aiEnd           = useRef<HTMLDivElement>(null);
  const prevMsgCount    = useRef(0);
  const newMeetingMenuRef = useRef<HTMLDivElement>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);
  const recognitionRef = useRef<any>(null);
  const callTimer       = useCallTimer(phase === 'in-call');

  useEffect(() => {
    if (!onContextReady) return;
    onContextReady({
      phase, roomId, roomName, displayName,
      participants, audioOn, videoOn, screenOn, recording,
      setPhase, setRoomId, setRoomName, setDisplayName,
      setParticipants, setAudioOn, setVideoOn, setScreenOn, setRecording,
      toggleAudio, toggleVideo, toggleScreen,
      endCall: () => endCall(),
      runAiStudio,
      aiStudioOpen, aiStudioResult,
      showInvite, setShowInvite,
    });
  }, [phase, roomId, participants, audioOn, videoOn, screenOn, recording, aiStudioOpen, aiStudioResult, showInvite]);

  useEffect(() => {
    if (!showNewMeetingMenu) return;
    const onDown = (e: MouseEvent) => {
      const el = newMeetingMenuRef.current;
      if (el && !el.contains(e.target as Node)) setShowNewMeetingMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowNewMeetingMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showNewMeetingMenu]);

  // Chat scroll
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { aiEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [aiMessages]);

  // Unread badge
  useEffect(() => {
    if ((!rightPanelOpen || rightTab !== 'chat') && messages.length > prevMsgCount.current)
      setUnread(u => u + messages.length - prevMsgCount.current);
    prevMsgCount.current = messages.length;
  }, [messages, rightTab, rightPanelOpen]);
  useEffect(() => { if (rightPanelOpen && rightTab === 'chat') setUnread(0); }, [rightTab, rightPanelOpen]);

  useEffect(() => { return () => { void endCall(true); }; }, []); // eslint-disable-line

  useEffect(() => {
    if (pipVideoRef.current && screenOn && localRef.current) {
      pipVideoRef.current.srcObject = localRef.current;
    }
  }, [screenOn]);

  useEffect(() => {
    const el = document.getElementById('pip-camera');
    if (!el) return;
    let dragging = false, ox = 0, oy = 0;
    const down = (e: MouseEvent) => { dragging = true; ox = e.clientX - el.offsetLeft; oy = e.clientY - el.offsetTop; el.style.cursor = 'grabbing'; };
    const move = (e: MouseEvent) => { if (!dragging) return; el.style.left = `${e.clientX - ox}px`; el.style.top = `${e.clientY - oy}px`; el.style.right = 'auto'; el.style.bottom = 'auto'; };
    const up = () => { dragging = false; el.style.cursor = 'grab'; };
    el.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { el.removeEventListener('mousedown', down); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [screenOn]);

  // ── Join ──────────────────────────────────────────────────────────────

  const joinCallRef = useRef<((o?: { roomId?: string; displayName?: string }) => Promise<void>) | null>(null);

  const joinCall = useCallback(async (overrides?: { roomId?: string; displayName?: string }) => {
    const effName = (overrides?.displayName ?? displayName).trim();
    const effRoom = (overrides?.roomId ?? roomId).trim();
    if (!effName) return;
    setPhase('connecting'); setError(null);
    try {
      const turnRes  = await api('/turn', { method: 'POST' });
      const turnData = await turnRes.json();
      iceRef.current = turnData.iceServers || [{ urls: 'stun:stun.cloudflare.com:3478' }];

      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localRef.current = stream;
      stream.getAudioTracks().forEach(t => { t.enabled = audioOn; });
      stream.getVideoTracks().forEach(t => { t.enabled = videoOn; });

      const roomRes  = await api('/room', {
        method: 'POST',
        body: JSON.stringify({ roomId: effRoom || undefined, name: `${effName}'s Meeting` }),
      });
      const roomData = await roomRes.json().catch(() => ({}));
      if (!roomRes.ok) {
        throw new Error(
          typeof roomData?.error === 'string'
            ? roomData.error
            : typeof roomData?.detail === 'string'
              ? roomData.detail
              : `Room setup failed (${roomRes.status})`,
        );
      }
      const rid = roomData.roomId;
      if (!rid) throw new Error('Server returned no room ID — check worker deployment');
      setRoomId(rid); setRoomName(roomData.name);

      const sessRes  = await api(`/room/${rid}/session`, {
        method: 'POST', body: JSON.stringify({ displayName: effName }),
      });
      const sessData = await sessRes.json().catch(() => ({}));
      if (!sessRes.ok) {
        throw new Error(
          typeof sessData?.error === 'string'
            ? sessData.error
            : typeof sessData?.detail === 'string'
              ? sessData.detail
              : `Session failed (${sessRes.status})`,
        );
      }
      if (!sessData.sessionId) throw new Error('Server returned no session ID');
      sessionRef.current = sessData.sessionId;

      const pc = new RTCPeerConnection({ iceServers: iceRef.current });
      pcRef.current = pc;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      pc.ontrack = ({ track, streams }) => {
        const existingStream = remoteStreams.current.get(track.id) || new MediaStream();
        existingStream.addTrack(track);
        remoteStreams.current.set(track.id, existingStream);
        setParticipants(prev => prev.map(p =>
          (p.tracks.length && !p.stream) ? { ...p, stream: existingStream } : p
        ));
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') setError('ICE failed — check network');
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const pubRes = await api(`/room/${rid}/publish`, {
        method: 'POST',
        body: JSON.stringify({
          sessionId: sessData.sessionId,
          offer: { type: offer.type, sdp: offer.sdp },
          tracks: [
            { location: 'local', mid: '0', trackName: 'microphone' },
            { location: 'local', mid: '1', trackName: 'camera' },
          ],
        }),
      });
      const pubData = await pubRes.json();
      if (pubData.answer) await pc.setRemoteDescription(pubData.answer);

      setPhase('in-call');
      startPolling(rid);
    } catch (err: any) {
      setError(err.message || 'Failed to join'); setPhase('lobby');
    }
  }, [displayName, roomId, audioOn, videoOn]);

  useEffect(() => {
    joinCallRef.current = joinCall;
  }, [joinCall]);

  const createMeetingForLater = useCallback(async () => {
    try {
      const res = await fetch('/api/meet/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Meeting ' + new Date().toLocaleDateString() }),
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.room?.id) {
        setNewMeetLink(`https://inneranimalmedia.com/dashboard/meet?room=${json.room.id}`);
      }
      setShowNewMeetingMenu(false);
      if (!res.ok) setError(typeof json?.error === 'string' ? json.error : 'Could not create meeting link');
    } catch {
      setError('Could not create meeting link');
      setShowNewMeetingMenu(false);
    }
  }, []);

  const startInstantMeeting = useCallback(async () => {
    if (!displayName.trim()) {
      setError('Enter your display name before starting a meeting.');
      setShowNewMeetingMenu(false);
      return;
    }
    setShowNewMeetingMenu(false);
    try {
      const res = await fetch('/api/meet/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Instant Meeting' }),
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.room?.id) {
        setRoomId(json.room.id);
        await joinCall({ roomId: json.room.id });
        setShowInvite(true);
      } else {
        setError(typeof json?.error === 'string' ? json.error : 'Could not start meeting');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not start meeting');
    }
  }, [joinCall, displayName]);

  const openScheduleFromMenu = useCallback(() => {
    setShowNewMeetingMenu(false);
    setShowScheduleForm(true);
  }, []);

  const copyNewMeetLink = useCallback(async () => {
    if (!newMeetLink) return;
    try {
      await navigator.clipboard.writeText(newMeetLink);
      setCopyLinkFeedback(true);
      window.setTimeout(() => setCopyLinkFeedback(false), 2000);
    } catch { /* ignore */ }
  }, [newMeetLink]);

  const submitScheduleMeeting = useCallback(async () => {
    if (!scheduleTitle.trim() || !scheduleDate) {
      setScheduleMsg({ ok: false, text: 'Title and date are required.' });
      return;
    }
    setScheduling(true);
    const emails = scheduleEmails.split(',').map(e => e.trim()).filter(Boolean);
    try {
      const res = await fetch('/api/meet/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: scheduleTitle.trim(),
          scheduled_at: scheduleDate,
          duration_min: scheduleDuration,
          invite_emails: emails,
          description: scheduleDesc,
        }),
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setScheduleMsg({ ok: true, text: 'Meeting scheduled. Invites sent.' });
        setShowScheduleForm(false);
        setScheduleTitle('');
        setScheduleDate('');
        setScheduleDuration(60);
        setScheduleEmails('');
        setScheduleDesc('');
      } else {
        setScheduleMsg({ ok: false, text: (json as { error?: string }).error ?? 'Failed to schedule meeting.' });
      }
    } catch (e: unknown) {
      setScheduleMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed to schedule meeting.' });
    } finally {
      setScheduling(false);
    }
  }, [scheduleTitle, scheduleDate, scheduleDuration, scheduleEmails, scheduleDesc]);

  const cancelScheduleForm = useCallback(() => {
    setShowScheduleForm(false);
    setScheduleTitle('');
    setScheduleDate('');
    setScheduleDuration(60);
    setScheduleEmails('');
    setScheduleDesc('');
  }, []);

  const autoJoinStarted = useRef(false);

  // Auto-join when ?room= is present — no manual lobby step.
  useEffect(() => {
    if (!roomFromUrl || autoJoinStarted.current) return;
    autoJoinStarted.current = true;
    let cancelled = false;
    (async () => {
      let dn = 'Guest';
      try {
        const r = await fetch('/api/settings/profile', { credentials: 'include' });
        if (r.ok) {
          const d = await r.json().catch(() => ({}));
          const flat = (d as { flat?: { display_name?: string; name?: string; primary_email?: string } }).flat || {};
          dn = String(flat.display_name || flat.name || '').trim()
            || String(flat.primary_email || '').split('@')[0]?.trim()
            || 'Guest';
        }
      } catch { /* use Guest */ }
      if (cancelled) return;
      setDisplayName(dn);
      setRoomId(roomFromUrl);
      await joinCallRef.current?.({ roomId: roomFromUrl, displayName: dn });
    })();
    return () => { cancelled = true; };
  }, [roomFromUrl]);

  // ── Polling / HB ──────────────────────────────────────────────────────

  /** In-call sync: poll room state (5s) + presence heartbeat (30s); pause when tab hidden. */
  const startPolling = (rid: string) => {
    meetVisCleanup.current?.();
    meetVisCleanup.current = null;
    if (pollTimer.current) clearInterval(pollTimer.current);
    if (hbTimer.current) clearInterval(hbTimer.current);
    pollTimer.current = null;
    hbTimer.current = null;

    const POLL_MS = 5000;
    const HB_MS = 30000;

    const poll = async () => {
      if (!rid || rid === 'undefined') return;
      try {
        const res  = await api(`/room/${rid}`);
        const data = await res.json();
        setRoomName(data.room?.name || '');
        setMessages(data.messages || []);
        const remotes = (data.participants || []).filter(
          (p: Participant) => p.session_id && p.session_id !== sessionRef.current
        );
        for (const p of remotes) {
          if (!knownSessions.current.has(p.session_id)) {
            knownSessions.current.add(p.session_id);
            void subscribeTo(rid, p);
          }
        }
        setParticipants(prev => {
          const map = new Map(prev.map(p => [p.user_id, p]));
          for (const rp of (data.participants || [])) {
            const ex = map.get(rp.user_id);
            map.set(rp.user_id, { ...rp, stream: ex?.stream, audioMuted: ex?.audioMuted, videoMuted: ex?.videoMuted });
          }
          return Array.from(map.values());
        });
      } catch { /* poll errors ignored */ }
    };

    const startTimers = () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      if (hbTimer.current) clearInterval(hbTimer.current);
      pollTimer.current = null;
      hbTimer.current = null;
      if (typeof document !== 'undefined' && document.hidden) return;

      void poll();
      pollTimer.current = window.setInterval(poll, POLL_MS);
      hbTimer.current = window.setInterval(() => {
        if (!rid || rid === 'undefined') return;
        api(`/room/${rid}/heartbeat`, { method: 'POST' }).catch(() => {});
      }, HB_MS);
    };

    const onVis = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        if (pollTimer.current) clearInterval(pollTimer.current);
        if (hbTimer.current) clearInterval(hbTimer.current);
        pollTimer.current = null;
        hbTimer.current = null;
      } else {
        startTimers();
      }
    };

    startTimers();
    document.addEventListener('visibilitychange', onVis);
    meetVisCleanup.current = () => document.removeEventListener('visibilitychange', onVis);
  };

  const subscribeTo = async (rid: string, p: Participant) => {
    const pc = pcRef.current; const sid = sessionRef.current;
    if (!pc || !sid || !p.tracks.length) return;
    const res = await api(`/room/${rid}/subscribe`, {
      method: 'POST',
      body: JSON.stringify({
        sessionId: sid,
        remoteTracks: p.tracks.map(t => ({ sessionId: p.session_id, trackName: t })),
      }),
    });
    const data = await res.json();
    if (data.requiresRenegotiation) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const re = await api(`/room/${rid}/renegotiate`, {
        method: 'POST',
        body: JSON.stringify({ sessionId: sid, offer: { type: offer.type, sdp: offer.sdp } }),
      });
      const reData = await re.json();
      if (reData.answer) await pc.setRemoteDescription(reData.answer);
    } else if (data.answer) {
      await pc.setRemoteDescription(data.answer);
    }
  };

  // ── Media controls ─────────────────────────────────────────────────────

  const toggleAudio = () => {
    const s = localRef.current; if (!s) return;
    const on = !audioOn; s.getAudioTracks().forEach(t => { t.enabled = on; }); setAudioOn(on);
  };
  const toggleVideo = () => {
    const s = localRef.current; if (!s) return;
    const on = !videoOn; s.getVideoTracks().forEach(t => { t.enabled = on; }); setVideoOn(on);
  };
  const toggleScreen = async () => {
    const pc = pcRef.current; if (!pc) return;
    if (screenOn) {
      screenRef.current?.getTracks().forEach(t => t.stop());
      screenRef.current = null; setScreenStreamState(null); setScreenOn(false); return;
    }
    try {
      const ss = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
      screenRef.current = ss; const st = ss.getVideoTracks()[0];
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(st);
      st.onended = () => {
        setScreenOn(false);
        setScreenStreamState(null);
        const cam = localRef.current?.getVideoTracks()[0];
        if (sender && cam) sender.replaceTrack(cam);
      };
      setScreenOn(true);
      setScreenStreamState(ss);
    } catch { /* user cancelled */ }
  };

  // ── End call ───────────────────────────────────────────────────────────

  const endCall = useCallback(async (silent = false) => {
    meetVisCleanup.current?.();
    meetVisCleanup.current = null;
    if (pollTimer.current) clearInterval(pollTimer.current);
    if (hbTimer.current)   clearInterval(hbTimer.current);
    localRef.current?.getTracks().forEach(t => t.stop());
    screenRef.current?.getTracks().forEach(t => t.stop());
    pcRef.current?.close();
    if (roomId && !silent) await api(`/room/${roomId}/leave`, { method: 'POST' }).catch(() => {});
    setPhase('ended');
  }, [roomId]);

  // ── Chat ───────────────────────────────────────────────────────────────

  const sendChat = async () => {
    const c = chatInput.trim(); if (!c || !roomId) return;
    setChatInput('');
    await api(`/room/${roomId}/chat`, { method: 'POST', body: JSON.stringify({ content: c }) }).catch(() => {});
  };

  const sendAiMessage = async () => {
    const c = aiInput.trim(); if (!c || aiLoading) return;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), user_id: 'self', display_name: displayName,
      content: c, created_at: new Date().toISOString(),
    };
    setAiMessages(prev => [...prev, userMsg]);
    setAiInput(''); setAiLoading(true);

    // Placeholder for SSE response — appended to as chunks arrive
    const aiMsgId = crypto.randomUUID();
    setAiMessages(prev => [...prev, {
      id: aiMsgId, user_id: 'agent', display_name: 'Agent Sam',
      content: '', created_at: new Date().toISOString(), isAi: true,
    }]);

    try {
      // Use the same FormData + SSE endpoint as ChatAssistant.tsx
      const form = new FormData();
      form.append('message', c);
      form.append('mode', 'agent');
      form.append('model', 'auto');
      form.append('conversationId', `meet_${roomId}`);
      form.append('contextMode', 'false');

      const res = await fetch('/api/agent/chat', {
        method: 'POST', credentials: 'include', body: form,
      });

      if (!res.ok || !res.body) throw new Error('Agent unavailable');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';
      let   full    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.startsWith('data: ') ? part.slice(6) : part;
          if (!line || line === '[DONE]') continue;
          try {
            const json = JSON.parse(line);
            // Skip non-text events (tool calls, approvals, etc.)
            if (json.type && json.type !== 'text_delta' && json.type !== 'content_block_delta') continue;
            const delta = json.delta?.text ?? json.text ?? json.content ?? '';
            if (delta) {
              full += delta;
              setAiMessages(prev => prev.map(m =>
                m.id === aiMsgId ? { ...m, content: full } : m
              ));
            }
          } catch { /* non-JSON line, skip */ }
        }
      }
      if (!full) {
        setAiMessages(prev => prev.map(m =>
          m.id === aiMsgId ? { ...m, content: 'No response from Agent Sam.' } : m
        ));
      }
    } catch {
      setAiMessages(prev => prev.map(m =>
        m.id === aiMsgId ? { ...m, content: 'Agent Sam is unavailable right now.' } : m
      ));
    } finally { setAiLoading(false); }
  };

  // ── AI Studio ──────────────────────────────────────────────────────────

  const runAiStudio = async (item: AiStudioItem) => {
    setAiStudioOpen(item); setAiStudioResult(null);
    if (item === 'transcript') {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) { setAiStudioResult('Speech recognition not supported in this browser.'); setAiStudioOpen('transcript'); return; }
      if (recognitionRef.current) {
        recognitionRef.current.stop(); recognitionRef.current = null;
        setAiStudioResult('Transcription stopped.'); return;
      }
      const r = new SR();
      r.continuous = true; r.interimResults = true; r.lang = 'en-US';
      r.onresult = (e: any) => {
        const text = Array.from(e.results as any[]).map((res: any) => res[0].transcript).join(' ');
        setAiStudioResult(text); setAiStudioOpen('transcript');
      };
      r.onerror = () => setAiStudioResult('Transcription error — check mic permissions.');
      r.start(); recognitionRef.current = r; setAiStudioOpen('transcript');
      return;
    }
    const transcript = messages.map(m => `${m.display_name}: ${m.content}`).join('\n');
    const prompts: Record<AiStudioItem, string> = {
      summary:    `Summarize this meeting in 3-5 bullet points:\n\n${transcript}`,
      takeaways:  `Extract the top 3 key takeaways from this meeting:\n\n${transcript}`,
      actions:    `List all action items and owners mentioned in this meeting:\n\n${transcript}`,
      transcript: `Format this chat as a clean meeting transcript:\n\n${transcript}`,
      recording:  '',
    };
    if (item === 'recording') {
      if (recording) {
        mediaRecorderRef.current?.stop();
        setRecording(false);
        setAiStudioResult('Recording stopped — saving…');
        return;
      }
      const stream = screenStreamState || localRef.current;
      if (!stream) { setAiStudioResult('No active stream to record.'); return; }
      try {
        const mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });
        recordingChunks.current = [];
        mr.ondataavailable = e => { if ((e as any).data?.size > 0) recordingChunks.current.push((e as any).data); };
        mr.onstop = async () => {
          const blob = new Blob(recordingChunks.current, { type: 'video/webm' });
          const form = new FormData();
          form.append('recording', blob, `meet_${roomId}_${Date.now()}.webm`);
          form.append('roomId', roomId);
          const res = await fetch('/api/meet/recording/save', { method: 'POST', credentials: 'include', body: form }).catch(() => null);
          setAiStudioResult(res?.ok ? 'Recording saved to R2 ✓' : 'Save failed — check console.');
        };
        mr.start(5000);
        mediaRecorderRef.current = mr;
        setRecording(true);
        setAiStudioResult(null);
      } catch (e: any) {
        setAiStudioResult(`MediaRecorder error: ${e.message}`);
      }
      return;
    }
    if (!transcript) { setAiStudioResult('No chat content yet to analyze.'); return; }
    try {
      const form = new FormData();
      form.append('message', prompts[item]);
      form.append('mode', 'agent');
      form.append('model', 'auto');
      form.append('conversationId', `meet_studio_${roomId}`);
      form.append('contextMode', 'false');
      const res = await fetch('/api/agent/chat', { method: 'POST', credentials: 'include', body: form });
      if (!res.ok || !res.body) throw new Error('Agent unavailable');
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   full    = '';
      let   buf     = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
        for (const p of parts) {
          const line = p.startsWith('data: ') ? p.slice(6) : p;
          if (!line || line === '[DONE]') continue;
          try {
            const json  = JSON.parse(line);
            const delta = json.delta?.text ?? json.text ?? json.content ?? '';
            if (delta) { full += delta; setAiStudioResult(full); }
          } catch { /* skip */ }
        }
      }
      if (!full) setAiStudioResult('No result from Agent Sam.');
    } catch { setAiStudioResult('Agent unavailable.'); }
  };

  // ── Tiles ──────────────────────────────────────────────────────────────

  const selfP: Participant = {
    user_id: 'self', display_name: displayName || 'You',
    session_id: sessionRef.current || '', tracks: ['microphone', 'camera'],
    stream: screenStreamState || localRef.current || undefined, audioMuted: !audioOn, videoMuted: !videoOn,
  };
  const allTiles = [selfP, ...participants.filter(p => p.user_id !== 'self')];
  const pinned   = pinnedId ? allTiles.find(p => p.user_id === pinnedId) : null;
  const others   = pinned ? allTiles.filter(p => p.user_id !== pinnedId) : allTiles;
  const gridCls  = ['grid-1','grid-2','grid-4','grid-4','grid-6','grid-6','grid-9','grid-9','grid-9'][Math.min(allTiles.length - 1, 8)] || 'grid-9';

  // ── LOBBY ────────────────────────────────────────────────────────────

  if (phase === 'lobby' || phase === 'connecting') return (
    <>
      <MeetCSS />
      <div className="lobby-wrap">
        <div className="lobby-card">
          <div className="lobby-preview">
            <div className="lobby-no-cam"><Camera size={36} /><span>Camera off until you join</span></div>
            <div className="lobby-preview-label">Lobby</div>
          </div>
          <div className="lobby-form">
            <div className="lobby-brand">
              <Radio size={16} />
              <span>InnerAnimalMedia</span>
              <span className="lobby-live-badge">MEET</span>
            </div>
            {roomFromUrl ? (
              <>
                <h2 className="lobby-heading">Joining room…</h2>
                {error && <div className="lobby-error">{error}</div>}
                <p className="lobby-sub" style={{ fontSize: 12, color: 'var(--text-muted, #4a7a75)', margin: 0 }}>
                  <span className="font-mono">{roomFromUrl}</span>
                </p>
                <button className="lobby-btn" type="button" disabled>
                  {phase === 'connecting'
                    ? <><Loader2 size={15} className="spin" /> Connecting…</>
                    : <><Loader2 size={15} className="spin" /> Starting…</>}
                </button>
              </>
            ) : (
              <>
                <h2 className="lobby-heading">Start or join a meeting</h2>
                {error && <div className="lobby-error">{error}</div>}
                <label className="lobby-label">Your name</label>
                <input className="lobby-input" value={displayName} onChange={e => setDisplayName(e.target.value)}
                  placeholder="Display name" onKeyDown={e => e.key === 'Enter' && void startInstantMeeting()} />
                <p className="lobby-sub" style={{ fontSize: 11, color: 'var(--text-muted, #4a7a75)', margin: '0 0 8px' }}>
                  Invite guests by email after you start — or share the join link. Guests open the link from their inbox; no room ID to paste.
                </p>
                <div className="lobby-dropdown-wrap" ref={newMeetingMenuRef}>
                  <button
                    type="button"
                    className="lobby-btn"
                    onClick={() => setShowNewMeetingMenu(v => !v)}
                    disabled={phase === 'connecting'}
                  >
                    New Meeting <ChevronDown size={15} />
                  </button>
                  {showNewMeetingMenu && (
                    <div className="lobby-dropdown-menu" role="menu">
                      <button type="button" className="lobby-dropdown-item" onClick={() => void createMeetingForLater()}>
                        Create a meeting for later
                      </button>
                      <button type="button" className="lobby-dropdown-item" onClick={() => void startInstantMeeting()}>
                        Start an instant meeting
                      </button>
                      <button type="button" className="lobby-dropdown-item" onClick={openScheduleFromMenu}>
                        Schedule a meeting
                      </button>
                    </div>
                  )}
                </div>
                {newMeetLink && (
                  <div className="lobby-link-share">
                    <div className="lobby-label">Your meeting link:</div>
                    <div className="lobby-link-select">{newMeetLink}</div>
                    <button type="button" className="lobby-btn-secondary" onClick={() => void copyNewMeetLink()}>
                      {copyLinkFeedback ? 'Copied' : 'Copy link'}
                    </button>
                  </div>
                )}
                {showScheduleForm && (
                  <div className="lobby-schedule-inline">
                    <input
                      className="lobby-input"
                      type="text"
                      placeholder="Meeting title"
                      value={scheduleTitle}
                      onChange={e => setScheduleTitle(e.target.value)}
                    />
                    <input
                      className="lobby-input"
                      type="datetime-local"
                      value={scheduleDate}
                      onChange={e => setScheduleDate(e.target.value)}
                    />
                    <select
                      className="lobby-input"
                      value={scheduleDuration}
                      onChange={e => setScheduleDuration(Number(e.target.value))}
                    >
                      <option value={30}>30 minutes</option>
                      <option value={60}>1 hour</option>
                      <option value={90}>1.5 hours</option>
                      <option value={120}>2 hours</option>
                    </select>
                    <input
                      className="lobby-input"
                      type="text"
                      placeholder="Invite: email1@example.com, email2@example.com"
                      value={scheduleEmails}
                      onChange={e => setScheduleEmails(e.target.value)}
                    />
                    <textarea
                      className="lobby-input lobby-textarea"
                      placeholder="Description (optional)"
                      value={scheduleDesc}
                      onChange={e => setScheduleDesc(e.target.value)}
                      rows={3}
                    />
                    <div className="lobby-schedule-actions">
                      <button type="button" className="lobby-btn" disabled={scheduling} onClick={() => void submitScheduleMeeting()}>
                        {scheduling ? <><Loader2 size={15} className="spin" /> Scheduling…</> : 'Schedule'}
                      </button>
                      <button type="button" className="lobby-btn-secondary" disabled={scheduling} onClick={cancelScheduleForm}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {scheduleMsg && (
                  <div className={scheduleMsg.ok ? 'lobby-schedule-msg ok' : 'lobby-schedule-msg err'}>{scheduleMsg.text}</div>
                )}
                <button className="lobby-btn" type="button" onClick={() => void startInstantMeeting()}
                  disabled={!displayName.trim() || phase === 'connecting'}>
                  {phase === 'connecting'
                    ? <><Loader2 size={15} className="spin" /> Starting…</>
                    : <><Video size={15} /> Start meeting</>}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );

  // ── ENDED ─────────────────────────────────────────────────────────────

  if (phase === 'ended') return (
    <>
      <MeetCSS />
      <div className="ended-wrap">
        <div className="ended-card">
          <PhoneOff size={28} />
          <h2>Call ended</h2>
          <button className="lobby-btn" onClick={() => { setPhase('lobby'); setParticipants([]); setMessages([]); }}>
            <Video size={15} /> New call
          </button>
        </div>
      </div>
    </>
  );

  // ── IN-CALL ───────────────────────────────────────────────────────────

  return (
    <>
      <MeetCSS />
      {showInvite && <InviteModal roomId={roomId} onClose={() => setShowInvite(false)} />}

      <div className="meet-root">

        {/* ── TOP BAR ── */}
        <div className="meet-topbar">
          <div className="tb-left">
            <Radio size={13} className="tb-brand-icon" />
            <span className="tb-brand">InnerAnimalMedia</span>
            <span className="tb-live">LIVE</span>
            <span className="tb-room">{roomName}</span>
            <span className="tb-count">{allTiles.length} in call · {callTimer}</span>
          </div>
          <div className="tb-right">
            {recording && (
              <div className="tb-recording">
                <span className="tb-rec-dot" />
                <span>Recording {callTimer}</span>
              </div>
            )}
            {error && <span className="tb-error">{error}</span>}
          </div>
        </div>

        {/* ── BODY ── */}
        <div className="meet-body">

          {/* ── VIDEO GRID ── */}
          <div className="meet-center">
            {pinned ? (
              <div className="pinned-layout">
                <div className="pinned-main">
                  <VideoTile p={pinned}
                    stream={pinned.user_id === 'self' ? (screenStreamState || localRef.current) ?? undefined : pinned.stream}
                    isSelf={pinned.user_id === 'self'} pinned onPin={() => setPinnedId(null)} />
                </div>
                <div className="pinned-strip">
                  {others.map(p => (
                    <VideoTile key={p.user_id} p={p}
                      stream={p.user_id === 'self' ? (screenStreamState || localRef.current) ?? undefined : p.stream}
                      isSelf={p.user_id === 'self'} pinned={false} onPin={() => setPinnedId(p.user_id)} />
                  ))}
                </div>
              </div>
            ) : (
              <div className={`video-grid ${gridCls}`}>
                {allTiles.map(p => (
                  <VideoTile key={p.user_id} p={p}
                    stream={p.user_id === 'self' ? (screenStreamState || localRef.current) ?? undefined : p.stream}
                    isSelf={p.user_id === 'self'} pinned={false} onPin={() => setPinnedId(p.user_id)} />
                ))}
              </div>
            )}
            {screenOn && (
              <div className="pip-camera-wrap" id="pip-camera">
                <video ref={pipVideoRef} autoPlay muted playsInline className="pip-camera-video" />
                <div className="pip-camera-label">You</div>
              </div>
            )}
          </div>

          {/* ── RIGHT PANEL ── */}
          {rightPanelOpen && (
            <div className="meet-right">
              <div className="right-tabs">
                {([
                  { id: 'chat', label: 'Chat' },
                  { id: 'ai',   label: 'AI Assistant' },
                ] as { id: RightTab; label: string }[]).map(tab => (
                  <button key={tab.id}
                    className={`right-tab ${rightTab === tab.id ? 'active' : ''}`}
                    onClick={() => setRightTab(tab.id)}>
                    {tab.label}
                    {tab.id === 'chat' && unread > 0 && <span className="right-unread">{unread}</span>}
                  </button>
                ))}
              </div>

              {/* Live Chat */}
              {rightTab === 'chat' && (
                <div className="right-panel-body">
                  <div className="chat-msgs">
                    {messages.length === 0 && <div className="chat-empty">No messages yet.</div>}
                    {messages.map(m => (
                      <div key={m.id} className="chat-msg">
                        <div className="chat-msg-meta">
                          <div className="chat-msg-avatar">{m.display_name.slice(0, 2).toUpperCase()}</div>
                          <span className="chat-msg-name">{m.display_name}</span>
                          <span className="chat-msg-time">{fmtTime(m.created_at)}</span>
                        </div>
                        <div className="chat-msg-body">{m.content}</div>
                      </div>
                    ))}
                    <div ref={chatEnd} />
                  </div>
                  <div className="chat-input-row">
                    <input className="chat-input" value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      placeholder="Send a message…"
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()} />
                    <button type="button" className="chat-send" onClick={sendChat} disabled={!chatInput.trim()}>
                      <Send size={14} />
                    </button>
                  </div>
                </div>
              )}

              {/* AI Assistant */}
              {rightTab === 'ai' && (
                <div className="right-panel-body">
                  <div className="chat-msgs">
                    {aiMessages.length === 0 && (
                      <div className="ai-welcome">
                        <Bot size={28} className="ai-welcome-icon" />
                        <p>Agent Sam is ready. Ask anything about the meeting, request a summary, or get help with a decision.</p>
                      </div>
                    )}
                    {aiMessages.map(m => (
                      <div key={m.id} className={`chat-msg ${m.isAi ? 'chat-msg-ai' : ''}`}>
                        <div className="chat-msg-meta">
                          <div className={`chat-msg-avatar ${m.isAi ? 'ai-avatar' : ''}`}>
                            {m.isAi ? <Bot size={12} /> : m.display_name.slice(0, 2).toUpperCase()}
                          </div>
                          <span className="chat-msg-name">{m.display_name}</span>
                          <span className="chat-msg-time">{fmtTime(m.created_at)}</span>
                        </div>
                        <div className="chat-msg-body">{m.content}</div>
                      </div>
                    ))}
                    {aiLoading && (
                      <div className="ai-typing"><Loader2 size={12} className="spin" /> Agent Sam is thinking…</div>
                    )}
                    <div ref={aiEnd} />
                  </div>
                  <div className="chat-input-row">
                    <input className="chat-input" value={aiInput}
                      onChange={e => setAiInput(e.target.value)}
                      placeholder="Ask Agent Sam…"
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendAiMessage()} />
                    <button className="chat-send" onClick={sendAiMessage} disabled={!aiInput.trim() || aiLoading}>
                      <Send size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>{/* end body */}

        {/* ── BOTTOM TOOLBAR ── */}
        <div className="meet-toolbar">
          <div className="toolbar-left">
            <button className={`ctrl ${!audioOn ? 'ctrl-off' : ''}`} onClick={toggleAudio}>
              {audioOn ? <Mic size={18} /> : <MicOff size={18} />}
              <span>{audioOn ? 'Mute' : 'Unmute'}</span>
            </button>
            <button className={`ctrl ${!videoOn ? 'ctrl-off' : ''}`} onClick={toggleVideo}>
              {videoOn ? <Camera size={18} /> : <CameraOff size={18} />}
              <span>{videoOn ? 'Camera' : 'No cam'}</span>
            </button>
            <button className={`ctrl ${screenOn ? 'ctrl-active' : ''}`} onClick={toggleScreen}>
              {screenOn ? <ScreenShareOff size={18} /> : <MonitorUp size={18} />}
              <span>Screen</span>
            </button>
          </div>
          <div className="toolbar-center">
            <button
              className={`ctrl ${rightPanelOpen ? 'ctrl-active' : ''}`}
              onClick={() => { setRightPanelOpen(p => !p); setUnread(0); }}
            >
              <MessageSquare size={18} />
              <span>Chat</span>
              {unread > 0 && <span className="ctrl-unread">{unread}</span>}
            </button>
          </div>
          <div className="toolbar-right">
            <button className="ctrl-leave" onClick={() => endCall()}>
              <PhoneOff size={16} /> Leave
            </button>
          </div>
        </div>

      </div>
    </>
  );
}

// ── CSS — 100% theme variable driven ─────────────────────────────────────

function MeetCSS() {
  return (
    <style>{`
      /* ─ Reset / root ─ */
      .meet-root {
        display: flex; flex-direction: column;
        width: 100%; height: 100%;
        overflow: hidden; box-sizing: border-box;
        font-family: var(--font-sans, 'Nunito', system-ui, sans-serif);
        font-size: 13px;
        color: var(--text-main, #c9d8d6);
        background: var(--bg-app, #07100f);
      }
      .lobby-wrap, .ended-wrap {
        display: flex; flex-direction: column;
        width: 100%; min-height: 100%;
        box-sizing: border-box;
        font-family: var(--font-sans, 'Nunito', system-ui, sans-serif);
        color: var(--text-main, #c9d8d6);
        background: var(--bg-app, #07100f);
      }
      /* mono only for code/pre output */
      .ai-studio-result pre, .chat-msg-body pre {
        font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace) !important;
      }

      /* ─ Topbar ─ */
      .meet-topbar {
        display: flex; align-items: center; justify-content: space-between;
        padding: 0 16px; height: 46px; flex-shrink: 0;
        background: var(--bg-panel, #0b1918);
        border-bottom: 1px solid var(--border, #1a2e2c);
        gap: 12px;
      }
      .tb-left, .tb-right { display: flex; align-items: center; gap: 10px; }
      .tb-right { margin-left: auto; }
      .tb-brand-icon { color: var(--primary, #2dd4bf); }
      .tb-brand { font-weight: 700; font-size: 13px; color: var(--text-main, #c9d8d6); letter-spacing: 0.01em; }
      .tb-live {
        background: var(--primary, #2dd4bf); color: var(--bg-app, #07100f);
        font-size: 9px; font-weight: 800; letter-spacing: 0.1em;
        padding: 2px 6px; border-radius: 3px;
      }
      .tb-room { font-size: 13px; color: var(--text-secondary, #6b9e99); font-weight: 500; }
      .tb-count { font-size: 11px; color: var(--text-muted, #4a7a75); }
      .tb-recording {
        display: flex; align-items: center; gap: 6px;
        font-size: 11px; color: var(--danger, #f87171);
        background: color-mix(in srgb, var(--danger, #f87171) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--danger, #f87171) 30%, transparent);
        padding: 3px 10px; border-radius: 4px;
      }
      .tb-rec-dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: var(--danger, #f87171);
        animation: pulse 1.5s infinite;
      }
      .tb-error { font-size: 11px; color: var(--danger, #f87171); }
      .tb-leave {
        display: flex; align-items: center; gap: 6px;
        background: var(--danger, #f87171); color: #fff;
        border: none; border-radius: 6px; padding: 6px 14px;
        font-size: 12px; font-weight: 600; font-family: inherit;
        cursor: pointer; transition: opacity 0.15s;
      }
      .tb-leave:hover { opacity: 0.85; }

      /* ─ Body ─ */
      .meet-body {
        position: relative;
        display: flex; flex: 1; overflow: hidden;
      }

      /* ─ Left panel ─ */
      .meet-left {
        width: 280px; flex-shrink: 0;
        background: var(--bg-panel, #0b1918);
        border-right: 1px solid var(--border, #1a2e2c);
        overflow-y: auto; display: flex; flex-direction: column;
        scrollbar-width: thin; scrollbar-color: var(--border, #1a2e2c) transparent;
      }
      .left-section {
        border-bottom: 1px solid var(--border, #1a2e2c);
        padding: 12px 0;
      }
      .left-section-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 0 14px 8px;
        font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
        text-transform: uppercase; color: var(--text-muted, #4a7a75);
      }
      .badge-beta {
        font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
        background: color-mix(in srgb, var(--primary, #2dd4bf) 15%, transparent);
        color: var(--primary, #2dd4bf);
        border: 1px solid color-mix(in srgb, var(--primary, #2dd4bf) 30%, transparent);
        padding: 1px 5px; border-radius: 3px;
      }
      .invite-btn {
        display: flex; align-items: center; gap: 4px;
        font-size: 11px; font-family: inherit; font-weight: 600;
        color: var(--primary, #2dd4bf);
        background: color-mix(in srgb, var(--primary, #2dd4bf) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--primary, #2dd4bf) 25%, transparent);
        border-radius: 4px; padding: 3px 8px; cursor: pointer; transition: all 0.15s;
      }
      .invite-btn:hover { background: color-mix(in srgb, var(--primary, #2dd4bf) 20%, transparent); }

      /* People */
      .people-list { display: flex; flex-direction: column; gap: 2px; padding: 0 8px; }
      .person-row {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 6px; border-radius: 6px; transition: background 0.1s;
      }
      .person-row:hover { background: var(--bg-surface, #0d1e1c); }
      .person-avatar {
        width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
        background: color-mix(in srgb, var(--primary, #2dd4bf) 15%, transparent);
        border: 1px solid color-mix(in srgb, var(--primary, #2dd4bf) 25%, transparent);
        display: flex; align-items: center; justify-content: center;
        font-size: 10px; font-weight: 700; color: var(--primary, #2dd4bf);
      }
      .person-avatar.sm { width: 24px; height: 24px; font-size: 9px; }
      .person-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .person-name { font-size: 12px; color: var(--text-main, #c9d8d6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .person-role { font-size: 10px; color: var(--text-muted, #4a7a75); }
      .person-icons { display: flex; gap: 4px; }
      .icon-active { color: var(--primary, #2dd4bf); }
      .icon-muted  { color: var(--danger, #f87171); }

      /* AI Studio rows */
      .ai-studio-row {
        display: flex; align-items: center; gap: 10px;
        width: 100%; padding: 8px 14px;
        background: none; border: none; font-family: inherit;
        cursor: pointer; transition: background 0.1s; text-align: left;
      }
      .ai-studio-row:hover { background: var(--bg-surface, #0d1e1c); }
      .ai-studio-row.active { background: color-mix(in srgb, var(--primary, #2dd4bf) 8%, transparent); }
      .ai-studio-row.recording .ai-studio-icon { color: var(--danger, #f87171); }
      .ai-studio-icon { color: var(--primary, #2dd4bf); flex-shrink: 0; }
      .ai-studio-text { display: flex; flex-direction: column; gap: 1px; }
      .ai-studio-label { font-size: 12px; font-weight: 500; color: var(--text-main, #c9d8d6); }
      .ai-studio-sub   { font-size: 10px; color: var(--text-muted, #4a7a75); }
      .ai-studio-result {
        margin: 6px 14px;
        background: var(--bg-surface, #0d1e1c);
        border: 1px solid var(--border, #1a2e2c);
        border-radius: 6px; padding: 10px;
        max-height: 180px; overflow-y: auto;
      }
      .ai-studio-result pre {
        font-size: 11px; color: var(--text-secondary, #6b9e99);
        white-space: pre-wrap; word-break: break-word; margin: 0; font-family: inherit;
      }
      .ai-result-close {
        display: block; margin-top: 8px; font-size: 10px; color: var(--text-muted, #4a7a75);
        background: none; border: none; cursor: pointer; font-family: inherit; padding: 0;
      }
      .ai-result-close:hover { color: var(--primary, #2dd4bf); }
      .ai-studio-loading {
        display: flex; align-items: center; gap: 6px;
        padding: 8px 14px; font-size: 11px; color: var(--text-muted, #4a7a75);
      }
      .rec-dot { color: var(--danger, #f87171) !important; }

      /* Tools */
      .tool-row {
        display: flex; align-items: center; gap: 10px;
        width: 100%; padding: 8px 14px;
        background: none; border: none; font-family: inherit; font-size: 12px;
        color: var(--text-secondary, #6b9e99); cursor: pointer; transition: all 0.1s; text-align: left;
      }
      .tool-row:hover { background: var(--bg-surface, #0d1e1c); color: var(--text-main, #c9d8d6); }
      .tool-row.active { color: var(--primary, #2dd4bf); background: color-mix(in srgb, var(--primary, #2dd4bf) 8%, transparent); }
      .tool-badge {
        margin-left: auto; font-size: 9px; font-weight: 700;
        background: color-mix(in srgb, var(--primary, #2dd4bf) 12%, transparent);
        color: var(--primary, #2dd4bf);
        border: 1px solid color-mix(in srgb, var(--primary, #2dd4bf) 25%, transparent);
        padding: 1px 5px; border-radius: 3px;
      }

      /* ─ Video center ─ */
      .meet-center {
        position: relative;
        flex: 1; display: flex; background: var(--bg-app, #07100f); overflow: hidden;
      }
      .pip-camera-wrap {
        position: absolute; bottom: 16px; right: 16px;
        width: 200px; height: 130px; border-radius: 10px; overflow: hidden;
        border: 2px solid var(--primary, #2dd4bf); z-index: 30;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5); cursor: grab;
      }
      .pip-camera-video { width: 100%; height: 100%; object-fit: cover; display: block; }
      .pip-camera-label {
        position: absolute; bottom: 5px; left: 8px;
        font-size: 10px; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.8);
      }
      .video-grid {
        display: grid; width: 100%; height: 100%; gap: 4px; padding: 8px;
      }
      .grid-1 { grid-template-columns: 1fr; }
      .grid-2 { grid-template-columns: repeat(2, 1fr); }
      .grid-4 { grid-template-columns: repeat(2, 1fr); grid-template-rows: repeat(2, 1fr); }
      .grid-6 { grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(2, 1fr); }
      .grid-9 { grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); }

      .pinned-layout { display: flex; width: 100%; height: 100%; gap: 4px; padding: 8px; }
      .pinned-main { flex: 1; min-width: 0; }
      .pinned-strip { width: 180px; flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }
      .pinned-strip .vtile { height: 120px; flex-shrink: 0; }

      /* Video tile */
      .vtile {
        position: relative; background: var(--bg-surface, #0d1e1c);
        border-radius: 10px; overflow: hidden;
        border: 1.5px solid var(--border, #1a2e2c);
        transition: border-color 0.15s;
        height: 100%;
      }
      .vtile:hover { border-color: color-mix(in srgb, var(--primary, #2dd4bf) 30%, transparent); }
      .vtile-pinned { border-color: color-mix(in srgb, var(--primary, #2dd4bf) 50%, transparent); }
      .vtile-speaking { border-color: var(--primary, #2dd4bf); box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary, #2dd4bf) 20%, transparent); }
      .vtile-video { width: 100%; height: 100%; object-fit: cover; display: block; }
      .vtile-avatar {
        width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
        background: radial-gradient(ellipse at center, color-mix(in srgb, var(--primary, #2dd4bf) 8%, var(--bg-surface, #0d1e1c)) 0%, var(--bg-surface, #0d1e1c) 100%);
      }
      .vtile-avatar span {
        font-size: clamp(20px, 4vw, 48px); font-weight: 700; color: var(--primary, #2dd4bf);
        text-shadow: 0 0 24px color-mix(in srgb, var(--primary, #2dd4bf) 40%, transparent);
      }
      .vtile-bar {
        position: absolute; bottom: 0; left: 0; right: 0;
        display: flex; align-items: center; justify-content: space-between;
        padding: 18px 8px 7px;
        background: linear-gradient(transparent, rgba(0,0,0,0.65));
      }
      .vtile-bar-left { display: flex; align-items: center; gap: 5px; }
      .vtile-name { font-size: 11px; font-weight: 500; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
      .vtile-icon-off { color: var(--danger, #f87171); }
      .vtile-icon-on  { color: var(--primary, #2dd4bf); }
      .vtile-icon-on.speaking { animation: pulse 1s infinite; }
      .vtile-pin-btn {
        background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 4px; padding: 3px; color: rgba(255,255,255,0.5);
        cursor: pointer; display: flex; align-items: center; transition: all 0.15s;
      }
      .vtile-pin-btn:hover { background: rgba(0,0,0,0.7); color: var(--primary, #2dd4bf); }
      .vtile-pin-btn .pinned { color: var(--primary, #2dd4bf); }

      /* ─ Right panel ─ */
      .meet-right {
        width: 320px; flex-shrink: 0;
        background: var(--bg-panel, #0b1918);
        border-left: 1px solid var(--border, #1a2e2c);
        display: flex; flex-direction: column; overflow: hidden;
      }
      .right-tabs {
        display: flex; align-items: center; flex-shrink: 0;
        background: var(--bg-surface, #0d1e1c);
        border-bottom: 1px solid var(--border, #1a2e2c);
      }
      .right-tab {
        flex: 1; position: relative;
        display: flex; align-items: center; justify-content: center; gap: 5px;
        padding: 11px 6px; font-size: 12px; font-weight: 500; font-family: inherit;
        color: var(--text-muted, #4a7a75);
        background: none; border: none; border-bottom: 2px solid transparent;
        cursor: pointer; transition: all 0.15s;
      }
      .right-tab:hover  { color: var(--text-secondary, #6b9e99); }
      .right-tab.active { color: var(--primary, #2dd4bf); border-bottom-color: var(--primary, #2dd4bf); }
      .right-unread {
        position: absolute; top: 6px; right: 6px;
        background: var(--danger, #f87171); color: #fff;
        font-size: 9px; font-weight: 700; border-radius: 8px;
        min-width: 15px; height: 15px; display: flex; align-items: center; justify-content: center; padding: 0 3px;
      }
      .right-panel-body { display: flex; flex-direction: column; flex: 1; overflow: hidden; }

      /* Chat shared */
      .chat-msgs {
        flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px;
        scrollbar-width: thin; scrollbar-color: var(--border, #1a2e2c) transparent;
      }
      .chat-empty { font-size: 12px; color: var(--text-muted, #4a7a75); text-align: center; padding: 24px 0; }
      .chat-msg { display: flex; flex-direction: column; gap: 4px; }
      .chat-msg-ai { background: color-mix(in srgb, var(--primary, #2dd4bf) 5%, transparent); border-radius: 8px; padding: 8px; }
      .chat-msg-meta { display: flex; align-items: center; gap: 7px; }
      .chat-msg-avatar {
        width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
        background: color-mix(in srgb, var(--primary, #2dd4bf) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--primary, #2dd4bf) 20%, transparent);
        display: flex; align-items: center; justify-content: center;
        font-size: 9px; font-weight: 700; color: var(--primary, #2dd4bf);
      }
      .chat-msg-avatar.ai-avatar { background: color-mix(in srgb, var(--primary, #2dd4bf) 20%, transparent); }
      .chat-msg-name { font-size: 11px; font-weight: 600; color: var(--primary, #2dd4bf); }
      .chat-msg-time { font-size: 10px; color: var(--text-muted, #4a7a75); margin-left: auto; }
      .chat-msg-body { font-size: 12px; color: var(--text-secondary, #6b9e99); line-height: 1.55; word-break: break-word; padding-left: 29px; }
      .chat-input-row {
        display: flex; align-items: center; gap: 6px;
        padding: 10px; border-top: 1px solid var(--border, #1a2e2c); flex-shrink: 0;
      }
      .chat-input {
        flex: 1; background: var(--bg-surface, #0d1e1c);
        border: 1px solid var(--border, #1a2e2c); border-radius: 6px;
        padding: 8px 10px; color: var(--text-main, #c9d8d6);
        font-size: 12px; font-family: inherit; outline: none; transition: border-color 0.15s;
      }
      .chat-input:focus { border-color: color-mix(in srgb, var(--primary, #2dd4bf) 35%, transparent); }
      .chat-input::placeholder { color: var(--text-muted, #4a7a75); }
      .chat-send {
        background: var(--bg-surface, #0d1e1c); border: 1px solid var(--border, #1a2e2c);
        border-radius: 6px; padding: 8px; color: var(--text-secondary, #6b9e99);
        cursor: pointer; display: flex; align-items: center; transition: all 0.15s;
      }
      .chat-send:hover:not(:disabled) { background: var(--primary, #2dd4bf); color: var(--bg-app, #07100f); border-color: var(--primary, #2dd4bf); }
      .chat-send:disabled { opacity: 0.3; cursor: not-allowed; }

      /* AI welcome */
      .ai-welcome { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 24px 16px; text-align: center; }
      .ai-welcome-icon { color: var(--primary, #2dd4bf); opacity: 0.5; }
      .ai-welcome p { font-size: 12px; color: var(--text-muted, #4a7a75); line-height: 1.6; margin: 0; }
      .ai-typing { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted, #4a7a75); }

      /* DM */
      .dm-person-row { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 6px; }
      .dm-person-row:hover { background: var(--bg-surface, #0d1e1c); }
      .dm-start-btn {
        margin-left: auto; background: none; border: 1px solid var(--border, #1a2e2c);
        border-radius: 4px; padding: 5px; color: var(--text-muted, #4a7a75);
        cursor: pointer; display: flex; align-items: center;
      }
      .dm-start-btn:hover { color: var(--primary, #2dd4bf); border-color: var(--primary, #2dd4bf); }

      /* ─ Toolbar ─ */
      .meet-toolbar {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        padding: 0 24px;
        height: 72px;
        flex-shrink: 0;
        background: var(--bg-panel, #0b1918);
        border-top: 1px solid var(--border, #1a2e2c);
      }
      .toolbar-left { display: flex; align-items: center; gap: 6px; justify-content: flex-start; }
      .toolbar-center { display: flex; align-items: center; gap: 6px; justify-content: center; }
      .toolbar-right  { display: flex; align-items: center; justify-content: flex-end; }
      .ctrl {
        position: relative;
        display: flex; flex-direction: column; align-items: center; gap: 3px;
        background: var(--bg-surface, #0d1e1c); border: 1px solid var(--border, #1a2e2c);
        border-radius: 10px; padding: 9px 16px; color: var(--text-secondary, #6b9e99);
        cursor: pointer; font-size: 11px; font-family: inherit; min-width: 66px;
        transition: all 0.15s;
      }
      .ctrl-unread {
        position: absolute; top: 6px; right: 8px;
        background: var(--danger, #f87171); color: #fff;
        font-size: 9px; font-weight: 700; border-radius: 8px;
        min-width: 15px; height: 15px; display: flex; align-items: center; justify-content: center; padding: 0 3px;
      }
      .ctrl:hover { background: color-mix(in srgb, var(--primary, #2dd4bf) 8%, var(--bg-surface, #0d1e1c)); color: var(--primary, #2dd4bf); border-color: color-mix(in srgb, var(--primary, #2dd4bf) 30%, transparent); }
      .ctrl-off { background: color-mix(in srgb, var(--danger, #f87171) 8%, var(--bg-surface, #0d1e1c)); border-color: color-mix(in srgb, var(--danger, #f87171) 25%, transparent); color: var(--danger, #f87171); }
      .ctrl-active { background: color-mix(in srgb, var(--primary, #2dd4bf) 12%, var(--bg-surface, #0d1e1c)); border-color: color-mix(in srgb, var(--primary, #2dd4bf) 40%, transparent); color: var(--primary, #2dd4bf); }
      .ctrl-leave {
        display: flex; align-items: center; gap: 7px;
        background: var(--danger, #f87171); color: #fff; border: none;
        border-radius: 10px; padding: 11px 22px; font-size: 13px; font-weight: 700;
        font-family: inherit; cursor: pointer; transition: opacity 0.15s;
      }
      .ctrl-leave:hover { opacity: 0.85; }

      /* ─ Polls ─ */
      .poll-panel { padding: 0 8px 8px; display: flex; flex-direction: column; gap: 8px; }
      .poll-card {
        background: var(--bg-surface, #0d1e1c); border: 1px solid var(--border, #1a2e2c);
        border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 6px;
      }
      .poll-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
      .poll-q { font-size: 11px; font-weight: 600; color: var(--text-main, #c9d8d6); line-height: 1.4; }
      .poll-live {
        font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 3px; flex-shrink: 0;
        background: color-mix(in srgb, var(--primary, #2dd4bf) 15%, transparent);
        color: var(--primary, #2dd4bf); border: 1px solid color-mix(in srgb, var(--primary, #2dd4bf) 30%, transparent);
      }
      .poll-opt {
        position: relative; display: flex; align-items: center; justify-content: space-between;
        background: var(--bg-panel, #0b1918); border: 1px solid var(--border, #1a2e2c);
        border-radius: 4px; padding: 5px 8px; cursor: pointer; overflow: hidden;
        transition: border-color 0.15s;
      }
      .poll-opt:hover { border-color: color-mix(in srgb, var(--primary, #2dd4bf) 30%, transparent); }
      .poll-opt-bar {
        position: absolute; left: 0; top: 0; bottom: 0;
        background: color-mix(in srgb, var(--primary, #2dd4bf) 12%, transparent);
        transition: width 0.3s ease; border-radius: 4px 0 0 4px;
      }
      .poll-opt-label { font-size: 11px; color: var(--text-secondary, #6b9e99); position: relative; z-index: 1; }
      .poll-opt-votes { font-size: 10px; color: var(--text-muted, #4a7a75); position: relative; z-index: 1; }
      .poll-total { font-size: 10px; color: var(--text-muted, #4a7a75); text-align: right; }
      .poll-create { padding: 4px 6px; display: flex; flex-direction: column; gap: 6px; }
      .poll-input {
        background: var(--bg-surface, #0d1e1c); border: 1px solid var(--border, #1a2e2c);
        border-radius: 5px; padding: 6px 10px; color: var(--text-main, #c9d8d6);
        font-size: 11px; font-family: inherit; outline: none;
      }
      .poll-input:focus { border-color: color-mix(in srgb, var(--primary, #2dd4bf) 35%, transparent); }
      .poll-add-opt {
        display: flex; align-items: center; gap: 5px;
        font-size: 11px; color: var(--text-muted, #4a7a75);
        background: none; border: none; cursor: pointer; font-family: inherit;
      }
      .poll-add-opt:hover { color: var(--primary, #2dd4bf); }
      .poll-create-actions { display: flex; gap: 6px; }
      .poll-cancel, .poll-submit {
        flex: 1; padding: 6px; border-radius: 5px; font-size: 11px; font-family: inherit;
        cursor: pointer; border: 1px solid var(--border, #1a2e2c); transition: all 0.15s;
      }
      .poll-cancel { background: var(--bg-surface, #0d1e1c); color: var(--text-muted, #4a7a75); }
      .poll-cancel:hover { color: var(--text-main, #c9d8d6); }
      .poll-submit { background: var(--primary, #2dd4bf); color: var(--bg-app, #07100f); font-weight: 700; border-color: transparent; }
      .poll-submit:hover { opacity: 0.85; }

      /* ─ Invite modal ─ */
      .modal-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 999;
        display: flex; align-items: center; justify-content: center;
      }
      .modal-card {
        background: var(--bg-panel, #0b1918); border: 1px solid var(--border, #1a2e2c);
        border-radius: 12px; padding: 24px; width: 380px; max-width: 90vw;
        display: flex; flex-direction: column; gap: 12px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.6);
      }
      .modal-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; color: var(--text-main, #c9d8d6); margin: 0; }
      .modal-sub { font-size: 12px; color: var(--text-muted, #4a7a75); margin: 0; }
      .modal-link-row {
        display: flex; align-items: center; gap: 8px;
        background: var(--bg-surface, #0d1e1c); border: 1px solid var(--border, #1a2e2c);
        border-radius: 6px; padding: 8px 10px;
      }
      .modal-link-val { flex: 1; font-size: 11px; color: var(--text-muted, #4a7a75); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .modal-copy-btn {
        display: flex; align-items: center; gap: 4px;
        font-size: 11px; color: var(--primary, #2dd4bf); background: none;
        border: 1px solid color-mix(in srgb, var(--primary, #2dd4bf) 25%, transparent);
        border-radius: 4px; padding: 3px 8px; cursor: pointer; font-family: inherit;
      }
      .modal-input {
        background: var(--bg-surface, #0d1e1c); border: 1px solid var(--border, #1a2e2c);
        border-radius: 6px; padding: 9px 12px; color: var(--text-main, #c9d8d6);
        font-size: 13px; font-family: inherit; outline: none; transition: border-color 0.15s;
      }
      .modal-input:focus { border-color: color-mix(in srgb, var(--primary, #2dd4bf) 35%, transparent); }
      .modal-input::placeholder { color: var(--text-muted, #4a7a75); }
      .modal-send-btn {
        display: flex; align-items: center; justify-content: center; gap: 7px;
        background: var(--primary, #2dd4bf); color: var(--bg-app, #07100f);
        border: none; border-radius: 7px; padding: 10px; font-size: 13px; font-weight: 700;
        font-family: inherit; cursor: pointer; transition: opacity 0.15s;
      }
      .modal-send-btn:hover:not(:disabled) { opacity: 0.85; }
      .modal-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .modal-sent { font-size: 12px; color: var(--primary, #2dd4bf); text-align: center; padding: 6px 0; }
      .modal-close {
        font-size: 12px; color: var(--text-muted, #4a7a75); background: none; border: none;
        cursor: pointer; font-family: inherit; text-align: center; padding: 4px;
      }
      .modal-close:hover { color: var(--text-secondary, #6b9e99); }

      /* ─ Lobby ─ */
      .lobby-wrap {
        width: 100%; min-height: 100vh; display: flex; align-items: center; justify-content: center;
        background: var(--bg-app, #07100f); padding: 20px;
      }
      .lobby-card {
        display: flex; gap: 32px;
        background: var(--bg-panel, #0b1918); border: 1px solid var(--border, #1a2e2c);
        border-radius: 16px; padding: 32px; max-width: 800px; width: 100%;
        box-shadow: 0 24px 80px rgba(0,0,0,0.5);
      }
      .lobby-preview {
        flex: 1; aspect-ratio: 16/9; background: var(--bg-surface, #0d1e1c);
        border: 1px solid var(--border, #1a2e2c); border-radius: 10px; overflow: hidden;
        position: relative; display: flex; align-items: center; justify-content: center; min-width: 0;
      }
      .lobby-vid { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
      .lobby-no-cam { display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--text-muted, #4a7a75); font-size: 12px; }
      .lobby-preview-label { position: absolute; bottom: 8px; left: 10px; font-size: 10px; color: var(--text-muted, #4a7a75); }
      .lobby-form { width: 260px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px; }
      .lobby-brand { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700; color: var(--primary, #2dd4bf); letter-spacing: 0.06em; }
      .lobby-live-badge {
        font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 3px; letter-spacing: 0.1em;
        background: var(--primary, #2dd4bf); color: var(--bg-app, #07100f);
      }
      .lobby-heading { font-size: 20px; font-weight: 700; color: var(--text-main, #c9d8d6); margin: 0; }
      .lobby-error { font-size: 12px; color: var(--danger, #f87171); background: color-mix(in srgb, var(--danger, #f87171) 8%, transparent); border: 1px solid color-mix(in srgb, var(--danger, #f87171) 20%, transparent); border-radius: 5px; padding: 7px 10px; }
      .lobby-label { font-size: 11px; color: var(--text-muted, #4a7a75); margin-bottom: -6px; }
      .lobby-hint { font-size: 10px; color: color-mix(in srgb, var(--text-muted, #4a7a75) 60%, transparent); }
      .lobby-input {
        background: var(--bg-surface, #0d1e1c); border: 1px solid var(--border, #1a2e2c);
        border-radius: 6px; padding: 9px 12px; color: var(--text-main, #c9d8d6);
        font-size: 13px; font-family: inherit; outline: none; width: 100%;
        transition: border-color 0.15s;
      }
      .lobby-input:focus { border-color: color-mix(in srgb, var(--primary, #2dd4bf) 35%, transparent); }
      .lobby-input::placeholder { color: var(--text-muted, #4a7a75); }
      .lobby-btn {
        display: flex; align-items: center; justify-content: center; gap: 8px;
        background: var(--primary, #2dd4bf); color: var(--bg-app, #07100f);
        border: none; border-radius: 8px; padding: 11px 16px; font-size: 13px; font-weight: 700;
        font-family: inherit; cursor: pointer; margin-top: 4px; transition: opacity 0.15s;
      }
      .lobby-btn:hover:not(:disabled) { opacity: 0.85; }
      .lobby-btn:disabled { opacity: 0.45; cursor: not-allowed; }
      .lobby-divider { text-align:center; font-size:11px; color:var(--text-muted,#4a7a75); margin:2px 0; }
      .lobby-btn-secondary { display:flex; align-items:center; justify-content:center; gap:8px; background:var(--bg-surface,#0d1e1c); color:var(--text-secondary,#6b9e99); border:1px solid var(--border,#1a2e2c); border-radius:8px; padding:10px 16px; font-size:13px; font-family:inherit; cursor:pointer; width:100%; transition:all .15s; }
      .lobby-btn-secondary:hover { border-color:var(--primary,#2dd4bf); color:var(--primary,#2dd4bf); }

      .lobby-dropdown-wrap { position: relative; width: 100%; }
      .lobby-dropdown-menu {
        position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 20;
        display: flex; flex-direction: column; gap: 0;
        background: var(--bg-panel, #0b1918); border: 1px solid var(--border, #1a2e2c);
        border-radius: 10px; padding: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.35);
      }
      .lobby-dropdown-item {
        text-align: left; padding: 10px 12px; border: none; border-radius: 8px;
        background: transparent; color: var(--text-main, #c9d8d6); font-size: 13px; cursor: pointer;
      }
      .lobby-dropdown-item:hover { background: var(--bg-hover, rgba(45,212,191,.08)); color: var(--primary, #2dd4bf); }

      .lobby-link-share { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; width: 100%; }
      .lobby-link-select {
        font-size: 12px; word-break: break-all; padding: 10px; border-radius: 8px;
        border: 1px solid var(--border, #1a2e2c); background: var(--bg-app, #07100f);
        color: var(--text-muted, #6b9e99); user-select: text;
      }

      .lobby-schedule-inline { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; width: 100%; }
      .lobby-textarea { min-height: 72px; resize: vertical; font-family: inherit; }
      .lobby-schedule-actions { display: flex; gap: 10px; flex-wrap: wrap; }
      .lobby-schedule-msg { font-size: 13px; margin-top: 8px; }
      .lobby-schedule-msg.ok { color: var(--primary, #2dd4bf); }
      .lobby-schedule-msg.err { color: var(--danger, #f87171); }

      /* ─ Ended ─ */
      .ended-wrap { width: 100%; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg-app, #07100f); }
      .ended-card {
        display: flex; flex-direction: column; align-items: center; gap: 16px;
        background: var(--bg-panel, #0b1918); border: 1px solid var(--border, #1a2e2c);
        border-radius: 16px; padding: 40px 48px; text-align: center;
        color: var(--text-muted, #4a7a75);
      }
      .ended-card h2 { font-size: 18px; color: var(--text-main, #c9d8d6); margin: 0; }

      /* ─ Misc ─ */
      .spin { animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.35; } }

      @media (max-width: 900px) { .meet-right { width: 260px; } }
      @media (max-width: 768px) {
        .meet-right { position:absolute; bottom:72px; left:0; right:0; width:100%; height:300px; z-index:10; border-left:none; border-top:1px solid var(--border,#1a2e2c); }
      }
      @media (max-width: 480px) {
        .meet-toolbar { height:60px; padding:0 8px; }
        .ctrl span { display:none; }
        .ctrl { min-width:42px; padding:10px; }
      }
    `}</style>
  );
}

