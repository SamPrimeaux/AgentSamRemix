import React, { useCallback } from 'react';
import { Building2, Globe, LayoutGrid, Lightbulb, Map, RefreshCw, SlidersHorizontal } from 'lucide-react';
import type {
  CityConfig, CityDistrictPreset, CityStreetPattern,
  CityStyle, CityTerrainStyle, CityViewPreset, CityStats,
} from '../../types';

interface Props {
  config: CityConfig;
  onChange: (patch: Partial<CityConfig>) => void;
  onRegenerate: () => void;
  stats?: CityStats;
}

// ── Slider ────────────────────────────────────────────────────────────────

function Slider({ label, value, min, max, step = 1, unit = '', color = '#00e5ff', onChange }: {
  label: string; value: number; min: number; max: number;
  step?: number; unit?: string; color?: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const display = step < 1 ? value.toFixed(1) : Math.round(value);
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span className="text-[10px] font-bold font-mono" style={{ color }}>{display}{unit}</span>
      </div>
      <div className="relative h-4 flex items-center">
        <div className="absolute inset-x-0 h-[2px] rounded-sm" style={{ background: 'var(--border-subtle)' }} />
        <div className="absolute left-0 h-[2px] rounded-sm" style={{ width: `${pct}%`, background: color }} />
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 opacity-0 cursor-pointer w-full"
        />
        <div
          className="absolute w-3.5 h-3.5 rounded-full pointer-events-none shadow-md"
          style={{ left: `calc(${pct}% - 7px)`, background: 'var(--bg-panel)', border: `2px solid ${color}` }}
        />
      </div>
    </div>
  );
}

function Select<T extends string>({ label, value, opts, onChange }: {
  label: string; value: T; opts: [T, string][]; onChange: (v: T) => void;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <select
        value={value} onChange={e => onChange(e.target.value as T)}
        className="w-full text-[11px] font-medium rounded-lg px-2.5 py-1.5 appearance-none cursor-pointer outline-none"
        style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', color: 'var(--text-main)' }}
      >
        {opts.map(([id, lbl]) => <option key={id} value={id}>{lbl}</option>)}
      </select>
    </div>
  );
}

function Section({ icon, title, accent = '#00e5ff', children }: {
  icon: React.ReactNode; title: string; accent?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.02)' }}>
      <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.03)' }}>
        <span style={{ color: accent, display: 'flex' }}>{icon}</span>
        <span className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>{title}</span>
      </div>
      <div className="p-3 flex flex-col gap-3.5">{children}</div>
    </div>
  );
}

const STYLE_SWATCHES: Record<CityStyle, string[]> = {
  modernGlass: ['#1c2a24', '#8cc8d5', '#788891', '#2b363b', '#63e7ff'],
  european:    ['#243629', '#d9c693', '#c4aa82', '#8b3f2f', '#ffd17c'],
  tokyoDense:  ['#202421', '#b8d5f0', '#d7d1c5', '#32363c', '#ff4f9a'],
  cyberpunk:   ['#171d24', '#4df0ff', '#334255', '#161b2b', '#ff3df2'],
  brutalist:   ['#252d28', '#aeb3b0', '#8d8a82', '#3a3a36', '#ffb347'],
  desert:      ['#2e2216', '#e8c870', '#c8a870', '#c06030', '#ff8030'],
};

const DISTRICT_PRESETS: Record<string, Partial<CityConfig>> = {
  downtown:       { commercial: 65, residential: 25, industrial: 10 },
  suburbia:       { commercial: 15, residential: 70, industrial: 15 },
  industrialBelt: { commercial: 16, residential: 20, industrial: 64 },
  mixedUse:       { commercial: 35, residential: 40, industrial: 25 },
};

export function CityControlDock({ config, onChange, onRegenerate, stats }: Props) {
  const set = useCallback(
    <K extends keyof CityConfig>(k: K, v: CityConfig[K]) => onChange({ [k]: v } as Partial<CityConfig>),
    [onChange],
  );

  return (
    <div className="flex flex-col gap-2">

      {/* Stats bar */}
      {stats && (
        <div className="flex gap-1.5 mb-1">
          {[`${stats.structures} structs`, `${stats.parks} parks`, stats.styleName].map(t => (
            <span key={t} className="flex-1 text-center text-[9px] font-bold uppercase tracking-[0.05em] rounded-md px-1.5 py-1 truncate"
              style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Regen */}
      <button type="button" onClick={onRegenerate}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.15em] cursor-pointer"
        style={{ border: '1px solid rgba(0,229,255,0.3)', background: 'rgba(0,229,255,0.06)', color: '#00e5ff' }}>
        <RefreshCw size={12} />Regenerate
      </button>

      <Section icon={<LayoutGrid size={12} />} title="Layout">
        <Slider label="City size"    value={config.citySize}  min={4}  max={30} unit=" blocks" onChange={v => set('citySize', v)} />
        <Slider label="Density"      value={config.density}   min={0}  max={100} unit="%"     onChange={v => set('density', v)} />
        <Slider label="Block size"   value={config.blockSize} min={6}  max={20} unit=" m"     onChange={v => set('blockSize', v)} />
        <Select label="Street pattern" value={config.streetPattern}
          opts={[['grid', 'Grid'], ['organic', 'Organic'], ['radial', 'Radial'], ['canal', 'Canal']] as [CityStreetPattern, string][]}
          onChange={v => set('streetPattern', v)} />
      </Section>

      <Section icon={<Map size={12} />} title="District Mix" accent="#e8821a">
        <Select label="Preset" value={config.districtPreset}
          opts={[['custom', 'Custom'], ['downtown', 'Downtown'], ['suburbia', 'Suburbia'], ['industrialBelt', 'Industrial Belt'], ['mixedUse', 'Mixed Use']] as [CityDistrictPreset, string][]}
          onChange={v => { const pre = DISTRICT_PRESETS[v] || {}; onChange({ districtPreset: v as CityDistrictPreset, ...pre }); }} />
        <Slider label="Commercial"  value={config.commercial}  min={0} max={100} unit="%" color="#e8821a" onChange={v => set('commercial', v)} />
        <Slider label="Residential" value={config.residential} min={0} max={100} unit="%" color="#e8821a" onChange={v => set('residential', v)} />
        <Slider label="Industrial"  value={config.industrial}  min={0} max={100} unit="%" color="#e8821a" onChange={v => set('industrial', v)} />
      </Section>

      <Section icon={<Building2 size={12} />} title="Skyline" accent="#a78bfa">
        <Slider label="Avg height"      value={config.averageHeight}  min={5}  max={100} unit=" m"  color="#a78bfa" onChange={v => set('averageHeight', v)} />
        <Slider label="Height variance" value={config.heightVariance} min={0}  max={100} unit="%"   color="#a78bfa" onChange={v => set('heightVariance', v)} />
        <Slider label="Landmark chance" value={config.landmarkChance} min={0}  max={30}  unit="%"   color="#a78bfa" onChange={v => set('landmarkChance', v)} />
      </Section>

      <Section icon={<SlidersHorizontal size={12} />} title="City Style" accent="#34d399">
        <Select label="Style" value={config.cityStyle}
          opts={[
            ['modernGlass', 'Modern Glass'], ['european', 'European'], ['tokyoDense', 'Tokyo Dense'],
            ['cyberpunk', 'Cyberpunk'], ['brutalist', 'Brutalist'], ['desert', 'Desert'],
          ] as [CityStyle, string][]}
          onChange={v => set('cityStyle', v)} />
        <div className="flex gap-1">
          {STYLE_SWATCHES[config.cityStyle].map((c, i) => (
            <div key={i} className="flex-1 h-4 rounded" style={{ background: c, border: '1px solid rgba(255,255,255,0.08)' }} />
          ))}
        </div>
      </Section>

      <Section icon={<Globe size={12} />} title="World" accent="#60a5fa">
        <Slider label="River prob"        value={config.riverProbability} min={0}  max={100} unit="%" color="#60a5fa" onChange={v => set('riverProbability', v)} />
        <Slider label="Parks %"           value={config.parksPercentage}  min={0}  max={50}  unit="%" color="#60a5fa" onChange={v => set('parksPercentage', v)} />
        <Slider label="Terrain roughness" value={config.terrainRoughness} min={0}  max={100} unit="%" color="#60a5fa" onChange={v => set('terrainRoughness', v)} />
        <Select label="Terrain" value={config.terrainStyle}
          opts={[['flatlands', 'Flatlands'], ['coastline', 'Coastline'], ['hills', 'Hills'], ['delta', 'Delta']] as [CityTerrainStyle, string][]}
          onChange={v => set('terrainStyle', v)} />
      </Section>

      <Section icon={<Lightbulb size={12} />} title="Lighting" accent="#fbbf24">
        <Slider label="Exposure"     value={config.exposure}    min={50}  max={200} unit="%" color="#fbbf24" onChange={v => set('exposure', v)} />
        <Slider label="Ambient fill" value={config.ambientFill} min={0}   max={150} unit="%" color="#fbbf24" onChange={v => set('ambientFill', v)} />
        <Slider label="Sun power"    value={config.sunPower}    min={50}  max={250} unit="%" color="#fbbf24" onChange={v => set('sunPower', v)} />
        <Slider label="Sun height"   value={config.sunHeight}   min={10}  max={200} unit=" m" color="#fbbf24" onChange={v => set('sunHeight', v)} />
      </Section>

      <Section icon={<Map size={12} />} title="View" accent="var(--text-muted)">
        <div className="grid grid-cols-2 gap-1">
          {(['orbit', 'overhead', 'isometric', 'street', 'cinematic'] as CityViewPreset[]).map(vp => (
            <button key={vp} type="button" onClick={() => set('viewPreset', vp)}
              className="py-1.5 px-2 rounded-lg text-[10px] font-bold capitalize cursor-pointer"
              style={{
                border: config.viewPreset === vp ? '1px solid rgba(0,229,255,0.5)' : '1px solid var(--border-subtle)',
                background: config.viewPreset === vp ? 'rgba(0,229,255,0.1)' : 'transparent',
                color: config.viewPreset === vp ? '#00e5ff' : 'var(--text-muted)',
              }}>
              {vp}
            </button>
          ))}
        </div>
      </Section>

    </div>
  );
}
