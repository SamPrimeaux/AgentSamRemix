type Opt = { value: string; label: string };

type Props = {
  type: string;
  status: string;
  validation: string;
  visibility: string;
  source: string;
  typeOptions: Opt[];
  statusOptions: Opt[];
  validationOptions: Opt[];
  visibilityOptions: Opt[];
  sourceOptions: Opt[];
  onChange: (k: 'type' | 'status' | 'validation' | 'visibility' | 'source', v: string) => void;
  onClear: () => void;
};

function Sel({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Opt[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-muted min-w-[120px]">
      {label}
      <select
        className="iam-lib-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ArtifactFilters({
  type,
  status,
  validation,
  visibility,
  source,
  typeOptions,
  statusOptions,
  validationOptions,
  visibilityOptions,
  sourceOptions,
  onChange,
  onClear,
}: Props) {
  const any =
    type || status || validation || visibility || source;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Sel label="Type" value={type} options={typeOptions} onChange={(v) => onChange('type', v)} />
      <Sel label="Status" value={status} options={statusOptions} onChange={(v) => onChange('status', v)} />
      <Sel label="Validation" value={validation} options={validationOptions} onChange={(v) => onChange('validation', v)} />
      <Sel label="Visibility" value={visibility} options={visibilityOptions} onChange={(v) => onChange('visibility', v)} />
      <Sel label="Source" value={source} options={sourceOptions} onChange={(v) => onChange('source', v)} />
      {any ? (
        <button type="button" className="iam-lib-btn iam-lib-btn--ghost text-[11px] mb-0.5" onClick={onClear}>
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
