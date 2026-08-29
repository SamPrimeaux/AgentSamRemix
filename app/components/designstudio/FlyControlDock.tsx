import React from 'react';
import { Navigation, Plane } from 'lucide-react';
import type { FlyConfig, FlyHud } from '../../types';

interface Props { config: FlyConfig; hud: FlyHud; onChange: (p: Partial<FlyConfig>) => void; }

function Section({ icon, title, accent = '#00e5ff', children }: {
  icon: React.ReactNode; title: string; accent?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.02)' }}>
      <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.03)' }}>
        <span style={{ color: accent, display: 'flex' }}>{icon}</span>
        <span className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

const VPS = ['Approach', 'Tower', 'Aerial', 'Overview'];

export function FlyControlDock({ config, hud, onChange }: Props) {
  return (
    <div className="flex flex-col gap-2">

      {/* HUD */}
      <Section icon={<Navigation size={12} />} title="Flight HUD">
        <div className="grid grid-cols-3 gap-px rounded-lg overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
          {([['MODE', hud.mode], ['ALT', `${hud.altitude} ft`], ['HDG', hud.heading]] as [string, string][]).map(([lbl, val]) => (
            <div key={lbl} className="text-center py-2.5 px-1" style={{ background: 'var(--bg-app)' }}>
              <div className="text-[8px] font-black uppercase tracking-[0.12em] mb-1" style={{ color: 'var(--text-muted)' }}>{lbl}</div>
              <div className="text-[10px] font-bold font-mono leading-none" style={{ color: '#00e5ff' }}>{val}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* Mode */}
      <Section icon={<Plane size={12} />} title="Mode" accent="#e8821a">
        <div className="grid grid-cols-2 gap-1.5">
          {(['autopilot', 'manual'] as const).map(m => (
            <button key={m} type="button" onClick={() => onChange({ mode: m })}
              className="py-2.5 rounded-lg text-[10px] font-black uppercase tracking-[0.1em] cursor-pointer"
              style={{
                border: config.mode === m ? 'none' : '1px solid var(--border-subtle)',
                background: config.mode === m ? '#00e5ff' : 'transparent',
                color: config.mode === m ? '#000' : 'var(--text-muted)',
              }}>
              {m === 'autopilot' ? 'Auto Pilot' : 'Manual'}
            </button>
          ))}
        </div>
        {config.mode === 'manual' && (
          <div className="mt-3 rounded-lg p-3 flex flex-col gap-1.5" style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)' }}>
            {([['Fly', 'W A S D'], ['Rise / Drop', 'Space / Q'], ['Boost', 'Shift'], ['Look', 'Drag mouse']] as [string, string][]).map(([a, b]) => (
              <div key={a} className="flex justify-between items-center">
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{a}</span>
                <span className="text-[10px] font-bold font-mono" style={{ color: '#00e5ff' }}>{b}</span>
              </div>
            ))}
            <div className="text-[9px] text-center mt-1" style={{ color: 'var(--text-muted)' }}>Click viewport to lock cursor</div>
          </div>
        )}
      </Section>

      {/* Viewpoints */}
      <Section icon={<Navigation size={12} />} title="Viewpoints" accent="#a78bfa">
        <div className="grid grid-cols-2 gap-1">
          {VPS.map((label, i) => (
            <button key={i} type="button" onClick={() => onChange({ viewpoint: i })}
              className="flex justify-between items-center px-2.5 py-2 rounded-lg text-[10px] font-bold cursor-pointer"
              style={{
                border: config.viewpoint === i ? '1px solid rgba(167,139,250,0.5)' : '1px solid var(--border-subtle)',
                background: config.viewpoint === i ? 'rgba(167,139,250,0.12)' : 'transparent',
                color: config.viewpoint === i ? '#a78bfa' : 'var(--text-muted)',
              }}>
              <span>{label}</span>
              <span className="text-[9px] font-mono opacity-50">{i + 1}</span>
            </button>
          ))}
        </div>
      </Section>

      {/* FOV */}
      <Section icon={<Navigation size={12} />} title="Field of View" accent="#60a5fa">
        <div className="flex justify-between mb-2">
          <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>FOV</span>
          <span className="text-[10px] font-bold font-mono" style={{ color: '#60a5fa' }}>{config.fov}deg</span>
        </div>
        <input type="range" min={30} max={90} step={1} value={config.fov}
          onChange={e => onChange({ fov: parseInt(e.target.value, 10) })}
          className="w-full" style={{ accentColor: '#60a5fa' }} />
      </Section>

    </div>
  );
}
