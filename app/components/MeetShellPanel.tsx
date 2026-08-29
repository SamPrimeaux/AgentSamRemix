import { useMeet } from '../src/MeetContext';
import {
  Sparkles,
  CheckSquare,
  FileText,
  AlignLeft,
  Circle,
  Aperture,
  MonitorUp,
  ScreenShareOff,
  BarChart2,
  Settings,
  Plus,
  Mic,
  MicOff,
} from 'lucide-react';

export function MeetShellPanel() {
  const meet = useMeet();
  if (meet.phase !== 'in-call') return <MeetLobbyPanel />;

  const handleScreenshot = () => {
    const video = document.querySelector('.vtile-video') as HTMLVideoElement;
    if (!video) { alert('No active video stream to capture.'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `meet-screenshot-${Date.now()}.png`;
    a.click();
  };

  const allPeople = [
    { user_id: 'self', display_name: meet.displayName || 'You', role: 'Host', audioMuted: !meet.audioOn },
    ...meet.participants.filter((p) => p.user_id !== 'self'),
  ];

  return (
    <div className="meet-shell-panel">
      {/* People */}
      <div className="msp-section">
        <div className="msp-header">
          <span>People ({allPeople.length})</span>
          <button className="msp-invite-btn" onClick={() => meet.setShowInvite(true)}>
            <Plus size={11} /> Invite
          </button>
        </div>
        {allPeople.map((p) => (
          <div key={p.user_id} className="msp-person-row">
            <div className="msp-avatar">{(p.display_name || '?').slice(0, 2).toUpperCase()}</div>
            <div className="msp-person-info">
              <span className="msp-person-name">
                {p.display_name}
                {p.user_id === 'self' ? ' (You)' : ''}
              </span>
              <span className="msp-person-role">{(p as any).role || 'Participant'}</span>
            </div>
            {p.audioMuted ? (
              <MicOff size={12} className="msp-icon-muted" />
            ) : (
              <Mic size={12} className="msp-icon-on" />
            )}
          </div>
        ))}
      </div>

      {/* AI Studio */}
      <div className="msp-section">
        <div className="msp-header">
          <span>AI Studio</span>
          <span className="msp-badge">BETA</span>
        </div>
        {[
          {
            id: 'summary',
            icon: <Sparkles size={13} />,
            label: 'Live Summary',
            sub:
              meet.aiStudioOpen === 'summary' && meet.aiStudioResult
                ? meet.aiStudioResult.slice(0, 60) + '…'
                : 'AI is summarizing this call',
          },
          { id: 'takeaways', icon: <CheckSquare size={13} />, label: 'Key Takeaways', sub: 'Waiting for content' },
          { id: 'actions', icon: <FileText size={13} />, label: 'Action Items', sub: 'Track tasks & owners' },
          { id: 'transcript', icon: <AlignLeft size={13} />, label: 'Transcription', sub: 'Live captions on' },
          {
            id: 'recording',
            icon: <Circle size={13} className={meet.recording ? 'msp-rec-dot' : ''} />,
            label: 'Recording',
            sub: meet.recording ? 'This call is being recorded' : 'Click to start recording',
          },
        ].map((item) => (
          <div key={item.id}>
            <button
              className={`msp-ai-row ${meet.aiStudioOpen === item.id ? 'active' : ''} ${
                item.id === 'recording' && meet.recording ? 'recording' : ''
              }`}
              onClick={() => meet.runAiStudio(item.id)}
            >
              <span className="msp-ai-icon">{item.icon}</span>
              <div className="msp-ai-text">
                <span className="msp-ai-label">{item.label}</span>
                <span className="msp-ai-sub">{item.sub}</span>
              </div>
            </button>
            {meet.aiStudioOpen === item.id && meet.aiStudioResult && (
              <div className="msp-ai-result"><pre>{meet.aiStudioResult}</pre></div>
            )}
          </div>
        ))}
      </div>

      {/* Tools */}
      <div className="msp-section">
        <div className="msp-header">
          <span>Tools</span>
        </div>
        <button className={`msp-tool-row ${meet.screenOn ? 'active' : ''}`} onClick={meet.toggleScreen}>
          {meet.screenOn ? <ScreenShareOff size={13} /> : <MonitorUp size={13} />}
          <span>{meet.screenOn ? 'Stop sharing' : 'Share Screen'}</span>
        </button>
        <button className="msp-tool-row" onClick={handleScreenshot}>
          <Aperture size={13} /><span>Screenshot</span>
        </button>
        <button className="msp-tool-row">
          <BarChart2 size={13} />
          <span>Polls</span>
        </button>
        <button className="msp-tool-row" onClick={() => (window.location.href = '/dashboard/settings')}>
          <Settings size={13} />
          <span>Settings</span>
        </button>
      </div>

      <MeetShellPanelStyles />
    </div>
  );
}

function MeetLobbyPanel() {
  return (
    <div className="meet-shell-panel">
      <div className="msp-section">
        <div className="msp-header">
          <span>Meet</span>
        </div>
        <div className="msp-lobby-hint">
          Join or start a meeting to see participants, AI Studio tools, and controls here.
        </div>
      </div>
      <MeetShellPanelStyles />
    </div>
  );
}

function MeetShellPanelStyles() {
  return (
    <style>{`
    .meet-shell-panel { display:flex; flex-direction:column; height:100%; overflow-y:auto; }
    .msp-section { border-bottom:1px solid var(--border,#1a2e2c); padding:10px 0; }
    .msp-header { display:flex; align-items:center; justify-content:space-between; padding:0 14px 7px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--text-muted,#4a7a75); }
    .msp-badge { font-size:9px; font-weight:700; padding:1px 5px; border-radius:3px; background:color-mix(in srgb,var(--primary,#2dd4bf) 15%,transparent); color:var(--primary,#2dd4bf); border:1px solid color-mix(in srgb,var(--primary,#2dd4bf) 30%,transparent); }
    .msp-invite-btn { display:flex; align-items:center; gap:4px; font-size:11px; font-weight:600; color:var(--primary,#2dd4bf); background:color-mix(in srgb,var(--primary,#2dd4bf) 10%,transparent); border:1px solid color-mix(in srgb,var(--primary,#2dd4bf) 25%,transparent); border-radius:4px; padding:3px 8px; cursor:pointer; font-family:inherit; }
    .msp-person-row { display:flex; align-items:center; gap:8px; padding:5px 14px; }
    .msp-person-row:hover { background:var(--bg-surface,#0d1e1c); }
    .msp-avatar { width:26px; height:26px; border-radius:50%; background:color-mix(in srgb,var(--primary,#2dd4bf) 15%,transparent); border:1px solid color-mix(in srgb,var(--primary,#2dd4bf) 25%,transparent); display:flex; align-items:center; justify-content:center; font-size:9px; font-weight:700; color:var(--primary,#2dd4bf); flex-shrink:0; }
    .msp-person-info { flex:1; min-width:0; }
    .msp-person-name { display:block; font-size:12px; color:var(--text-main,#c9d8d6); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .msp-person-role { display:block; font-size:10px; color:var(--text-muted,#4a7a75); }
    .msp-icon-on { color:var(--primary,#2dd4bf); } .msp-icon-muted { color:var(--danger,#f87171); }
    .msp-ai-row { display:flex; align-items:center; gap:10px; width:100%; padding:7px 14px; background:none; border:none; font-family:inherit; cursor:pointer; text-align:left; transition:background .1s; }
    .msp-ai-row:hover { background:var(--bg-surface,#0d1e1c); }
    .msp-ai-row.active { background:color-mix(in srgb,var(--primary,#2dd4bf) 8%,transparent); }
    .msp-ai-row.recording .msp-ai-icon { color:var(--danger,#f87171); }
    .msp-ai-icon { color:var(--primary,#2dd4bf); flex-shrink:0; }
    .msp-ai-label { display:block; font-size:12px; font-weight:500; color:var(--text-main,#c9d8d6); }
    .msp-ai-sub { display:block; font-size:10px; color:var(--text-muted,#4a7a75); }
    .msp-rec-dot { color:var(--danger,#f87171) !important; animation:pulse 1.5s infinite; }
    .msp-ai-result { margin: 0 14px 8px; background: var(--bg-surface,#0d1e1c); border: 1px solid var(--border,#1a2e2c); border-radius: 6px; padding: 8px; max-height: 160px; overflow-y: auto; }
    .msp-ai-result pre { font-size: 10px; color: var(--text-secondary,#6b9e99); white-space: pre-wrap; word-break: break-word; margin: 0; font-family: inherit; }
    .msp-tool-row { display:flex; align-items:center; gap:10px; width:100%; padding:7px 14px; background:none; border:none; font-size:12px; font-family:inherit; color:var(--text-secondary,#6b9e99); cursor:pointer; transition:all .1s; text-align:left; }
    .msp-tool-row:hover { background:var(--bg-surface,#0d1e1c); color:var(--text-main,#c9d8d6); }
    .msp-tool-row.active { color:var(--primary,#2dd4bf); background:color-mix(in srgb,var(--primary,#2dd4bf) 8%,transparent); }
    .msp-tool-badge { margin-left:auto; font-size:9px; font-weight:700; padding:1px 5px; border-radius:3px; background:color-mix(in srgb,var(--primary,#2dd4bf) 12%,transparent); color:var(--primary,#2dd4bf); border:1px solid color-mix(in srgb,var(--primary,#2dd4bf) 25%,transparent); }
    .msp-draw-opacity { display:flex; align-items:center; gap:8px; padding:4px 14px 6px; font-size:10px; color:var(--text-muted,#4a7a75); }
    .msp-draw-opacity input { flex:1; accent-color:var(--primary,#2dd4bf); }
    .msp-lobby-hint { padding:8px 14px; font-size:11px; color:var(--text-muted,#4a7a75); line-height:1.6; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
  `}</style>
  );
}
