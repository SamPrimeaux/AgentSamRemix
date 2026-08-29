/**
 * ViewportActionBar — claymorphic floating toolbar
 * Sits over the bottom-center of the 3D viewport.
 * Retry · Texture · Remesh · Unwrap UV  |  Rig  |  Download  |  ···
 */
import React from 'react';
import {
  RefreshCw, Paintbrush, Layers2, Ungroup,
  Clapperboard, Download, MoreHorizontal,
} from 'lucide-react';

export type ViewportActionBarProps = {
  onTexture: () => void;
  onRemesh: () => void;
  onUnwrapUV: () => void;
  onRig: () => void;
  rigActive?: boolean;
  onDownload: () => void;
  onAdvanced: () => void;
  hasSelection?: boolean;
};

type BtnProps = {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  accent?: boolean;
};

function Btn({ icon: Icon, label, onClick, active, disabled, accent }: BtnProps) {
  return (
    <button
      type="button"
      className={[
        'vab__btn',
        active ? 'vab__btn--active' : '',
        accent ? 'vab__btn--accent' : '',
        disabled ? 'vab__btn--disabled' : '',
      ].filter(Boolean).join(' ')}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon size={15} strokeWidth={1.75} />
      <span className="vab__label">{label}</span>
    </button>
  );
}

function Sep() {
  return <span className="vab__sep" aria-hidden />;
}

export function ViewportActionBar({
  onTexture, onRemesh, onUnwrapUV, onRig, rigActive,
  onDownload, onAdvanced, hasSelection,
}: ViewportActionBarProps) {
  return (
    <div className="vab__wrap" aria-label="Viewport actions">
      <div className="vab__dock">
        <Btn icon={RefreshCw}    label="Retry"      onClick={onTexture}   disabled={!hasSelection} />
        <Btn icon={Paintbrush}   label="Texture"    onClick={onTexture}   disabled={!hasSelection} />
        <Btn icon={Layers2}      label="Remesh"     onClick={onRemesh}    disabled={!hasSelection} />
        <Btn icon={Ungroup}      label="Unwrap UV"  onClick={onUnwrapUV}  disabled={!hasSelection} />
        <Sep />
        <Btn icon={Clapperboard} label="Rig"        onClick={onRig}       active={rigActive} accent />
        <Sep />
        <Btn icon={Download}     label="Download"   onClick={onDownload}  />
        <Btn icon={MoreHorizontal} label="Advanced" onClick={onAdvanced}  />
      </div>
    </div>
  );
}
