import { FileCode, FileText, LayoutTemplate, Network, Package, Sparkles } from 'lucide-react';
import type { ArtifactRecord } from '../../client-api/artifacts';
import { formatArtifactType } from './utils';

type Props = { artifact: ArtifactRecord; className?: string };

function HtmlPreview() {
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ background: '#0f0f11' }}
      aria-hidden
    >
      <svg width="56" height="44" viewBox="0 0 56 44" fill="none">
        <rect x="4" y="4" width="48" height="36" rx="4" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        <rect x="4" y="4" width="48" height="8" rx="4" fill="rgba(255,255,255,0.05)" />
        <circle cx="12" cy="8" r="2" fill="rgba(255,255,255,0.2)" />
        <circle cx="19" cy="8" r="2" fill="rgba(255,255,255,0.12)" />
        <circle cx="26" cy="8" r="2" fill="rgba(255,255,255,0.08)" />
        <rect x="10" y="17" width="18" height="1.5" rx="0.75" fill="rgba(147,197,253,0.35)" />
        <rect x="10" y="21" width="28" height="1.5" rx="0.75" fill="rgba(255,255,255,0.12)" />
        <rect x="10" y="25" width="22" height="1.5" rx="0.75" fill="rgba(255,255,255,0.09)" />
        <rect x="10" y="29" width="14" height="1.5" rx="0.75" fill="rgba(167,139,250,0.3)" />
      </svg>
    </div>
  );
}

function ExcalidrawPreview() {
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ background: 'var(--dashboard-canvas)' }}
      aria-hidden
    >
      <svg width="72" height="52" viewBox="0 0 72 52" fill="none">
        <rect x="4" y="10" width="18" height="12" rx="3" fill="none" stroke="rgba(167,139,250,0.6)" strokeWidth="1.2" />
        <rect x="50" y="10" width="18" height="12" rx="3" fill="none" stroke="rgba(167,139,250,0.6)" strokeWidth="1.2" />
        <rect x="26" y="30" width="20" height="12" rx="3" fill="none" stroke="rgba(167,139,250,0.6)" strokeWidth="1.2" />
        <line x1="22" y1="16" x2="50" y2="16" stroke="rgba(196,181,253,0.4)" strokeWidth="0.8" strokeDasharray="3 2" />
        <line x1="36" y1="22" x2="36" y2="30" stroke="rgba(196,181,253,0.4)" strokeWidth="0.8" strokeDasharray="3 2" />
      </svg>
    </div>
  );
}

function MarkdownPreview() {
  return (
    <div
      className="w-full h-full flex flex-col justify-center px-4 py-3 gap-1.5"
      style={{ background: 'var(--dashboard-panel)' }}
      aria-hidden
    >
      <div style={{ height: '3px', width: '55%', borderRadius: '2px', background: 'var(--text-primary)', opacity: 0.25 }} />
      <div style={{ height: '2px', width: '85%', borderRadius: '1px', background: 'var(--text-muted)', opacity: 0.18 }} />
      <div style={{ height: '2px', width: '70%', borderRadius: '1px', background: 'var(--text-muted)', opacity: 0.14 }} />
      <div style={{ height: '2px', width: '90%', borderRadius: '1px', background: 'var(--text-muted)', opacity: 0.14 }} />
      <div style={{ height: '2px', width: '60%', borderRadius: '1px', background: 'var(--text-muted)', opacity: 0.1 }} />
      <div style={{ height: '2px', width: '78%', borderRadius: '1px', background: 'var(--text-muted)', opacity: 0.1 }} />
    </div>
  );
}

function SqlPreview() {
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ background: '#0a0f14' }}
      aria-hidden
    >
      <svg width="64" height="44" viewBox="0 0 64 44" fill="none">
        <rect x="4" y="6" width="56" height="7" rx="2" fill="rgba(52,211,153,0.08)" />
        <rect x="8" y="9" width="20" height="1.5" rx="0.75" fill="rgba(52,211,153,0.5)" />
        <rect x="4" y="17" width="56" height="5" rx="1.5" fill="rgba(255,255,255,0.04)" />
        <rect x="8" y="19" width="36" height="1.5" rx="0.75" fill="rgba(255,255,255,0.15)" />
        <rect x="4" y="25" width="56" height="5" rx="1.5" fill="rgba(255,255,255,0.03)" />
        <rect x="8" y="27" width="28" height="1.5" rx="0.75" fill="rgba(255,255,255,0.1)" />
        <rect x="4" y="33" width="56" height="5" rx="1.5" />
        <rect x="8" y="35" width="44" height="1.5" rx="0.75" fill="rgba(255,255,255,0.07)" />
      </svg>
    </div>
  );
}

export function ArtifactTypeIcon({ artifact, className = '' }: Props) {
  const t = (artifact.artifact_type || '').toLowerCase();

  const isHtml = t === 'html' || t === 'jsx' || t === 'tsx' || t.includes('component') || t.includes('template');
  const isExcalidraw = t === 'excalidraw' || t.includes('graph') || t.includes('schema') || t.includes('flow') || t.includes('drag');
  const isMarkdown = t === 'markdown' || t.includes('md') || t === 'report' || t.includes('spec') || t === 'plan';
  const isSql = t === 'sql' || t.includes('migration') || t.includes('query');

  if (isHtml) {
    return (
      <div className={`rounded-lg overflow-hidden ${className}`} title={formatArtifactType(artifact.artifact_type)}>
        <HtmlPreview />
      </div>
    );
  }
  if (isExcalidraw) {
    return (
      <div className={`rounded-lg overflow-hidden border border-[var(--dashboard-border)] ${className}`} title={formatArtifactType(artifact.artifact_type)}>
        <ExcalidrawPreview />
      </div>
    );
  }
  if (isMarkdown) {
    return (
      <div className={`rounded-lg overflow-hidden border border-[var(--dashboard-border)] ${className}`} title={formatArtifactType(artifact.artifact_type)}>
        <MarkdownPreview />
      </div>
    );
  }
  if (isSql) {
    return (
      <div className={`rounded-lg overflow-hidden ${className}`} title={formatArtifactType(artifact.artifact_type)}>
        <SqlPreview />
      </div>
    );
  }

  let Icon = Package;
  if (t.includes('visualizer')) Icon = Sparkles;
  else if (t === 'report' || t.includes('spec')) Icon = FileCode;
  else if (t === 'markdown' || t.includes('md')) Icon = FileText;
  else if (t.includes('template') || t.includes('flow')) Icon = LayoutTemplate;
  else if (t.includes('graph') || t.includes('schema')) Icon = Network;

  return (
    <div
      className={`flex items-center justify-center rounded-lg bg-[var(--dashboard-panel)] border border-[var(--dashboard-border)] ${className}`}
      title={formatArtifactType(artifact.artifact_type)}
    >
      <Icon size={28} className="text-muted opacity-90" aria-hidden />
    </div>
  );
}
