import React from 'react';
import { Link } from 'react-router-dom';
import { KEYS_PATH } from './MeshyPlatformNotice';

type TaskIdFieldProps = {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
};

export function MeshyTaskIdField({
  label = 'Source model task ID',
  value,
  onChange,
  placeholder = 'Completed Meshy text/image-to-3D task ID',
}: TaskIdFieldProps) {
  return (
    <div>
      <label className="text-[10px] font-bold text-muted uppercase tracking-[0.14em] block mb-1.5">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-[11px] font-mono text-main border border-[var(--border-subtle)] bg-[var(--bg-hover)] outline-none focus:border-[var(--solar-cyan)] transition-colors"
      />
    </div>
  );
}

export function MeshyPromptField({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <div>
      <label className="text-[10px] font-bold text-muted uppercase tracking-[0.14em] block mb-1.5">
        {label}
      </label>
      <textarea
        rows={rows}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-[12px] text-main border border-[var(--border-subtle)] bg-[var(--bg-hover)] outline-none focus:border-[var(--solar-cyan)] resize-none"
      />
    </div>
  );
}

export function MeshyKeysLink() {
  return (
    <p className="text-[10px] text-muted leading-relaxed">
      Uses platform <code className="font-mono text-[9px]">MESHYAI_API_KEY</code>. For personal quota, add BYOK in{' '}
      <Link to={KEYS_PATH} className="text-[var(--solar-cyan)] hover:underline font-semibold">
        Settings → Keys
      </Link>
      .
    </p>
  );
}
