import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { STARTER_COMMAND_SUGGESTIONS } from './agentsSectionHelpers';

export type AllowlistChipInputProps = {
  label?: string;
  /** When true, header label is omitted — use inside accordions. */
  hideLabel?: boolean;
  hint?: string;
  placeholder: string;
  items: string[];
  inputValue: string;
  onInputChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (item: string) => void;
  onAddBulk?: (items: string[]) => Promise<void> | void;
  existingCommands?: string[];
  workspaceId?: string | null;
  showSuggestions?: boolean;
  disabled?: boolean;
};

function chipClassName() {
  return 'inline-flex items-center gap-1 max-w-full pl-2.5 pr-1 py-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[11px] font-mono text-[var(--solar-cyan)]';
}

type CommandSuggestion = { pattern: string; category?: string };

function CommandSuggestionsPopover({
  disabled,
  addingBulk,
  existingCommands,
  suggestionsOpen,
  setSuggestionsOpen,
  suggestionsLoading,
  suggestions,
  selected,
  toggleSelected,
  onAddSelected,
  popoverRef,
}: {
  disabled: boolean;
  addingBulk: boolean;
  existingCommands: string[];
  suggestionsOpen: boolean;
  setSuggestionsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  suggestionsLoading: boolean;
  suggestions: CommandSuggestion[];
  selected: Set<string>;
  toggleSelected: (pattern: string) => void;
  onAddSelected: () => void;
  popoverRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setSuggestionsOpen((o) => !o)}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[10px] font-semibold uppercase tracking-wide text-muted hover:text-[var(--solar-cyan)] hover:border-[var(--solar-cyan)]/40 disabled:opacity-40"
      >
        Add suggestions
        <ChevronDown size={12} className={suggestionsOpen ? 'rotate-180' : ''} />
      </button>
      {suggestionsOpen ? (
        <div className="absolute right-0 top-full mt-1 z-50 w-[min(100vw-2rem,22rem)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-lg p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            {existingCommands.length === 0 ? 'Starter commands' : 'Suggested commands'}
          </div>
          {suggestionsLoading ? (
            <div className="text-[11px] text-muted py-2">Loading…</div>
          ) : suggestions.length === 0 ? (
            <div className="text-[11px] text-muted py-2">No suggestions available</div>
          ) : (
            <div className="max-h-56 overflow-y-auto space-y-1 mb-3">
              {suggestions.map((row) => (
                <label
                  key={row.pattern}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] cursor-pointer text-[11px]"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(row.pattern)}
                    onChange={() => toggleSelected(row.pattern)}
                    className="rounded border-[var(--border-subtle)]"
                  />
                  <code className="font-mono text-[var(--solar-cyan)] truncate">{row.pattern}</code>
                  {row.category ? (
                    <span className="text-[9px] text-muted ml-auto shrink-0">
                      {row.category}
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          )}
          <button
            type="button"
            disabled={disabled || addingBulk || selected.size === 0}
            onClick={onAddSelected}
            className="w-full px-3 py-2 rounded-lg bg-[var(--solar-cyan)]/15 text-[11px] font-semibold text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30 disabled:opacity-40"
          >
            {addingBulk ? 'Adding…' : `Add selected (${selected.size})`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AllowlistChipInput({
  label,
  hideLabel = false,
  hint,
  placeholder,
  items,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
  onAddBulk,
  existingCommands = [],
  workspaceId,
  showSuggestions = false,
  disabled = false,
}: AllowlistChipInputProps) {
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<CommandSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addingBulk, setAddingBulk] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const existingSet = useMemo(() => new Set(existingCommands.map((c) => c.trim())), [existingCommands]);

  const loadSuggestions = useCallback(async () => {
    const isEmpty = existingCommands.length === 0;
    if (isEmpty) {
      const defaults = STARTER_COMMAND_SUGGESTIONS.filter((c) => !existingSet.has(c));
      setSuggestions(defaults.map((pattern) => ({ pattern })));
      setSelected(new Set(defaults));
      return;
    }

    setSuggestionsLoading(true);
    try {
      const qp =
        workspaceId && workspaceId.trim()
          ? `?workspace_id=${encodeURIComponent(workspaceId.trim())}`
          : '';
      const r = await fetch(`/api/settings/allowlist/command-suggestions${qp}`, {
        credentials: 'same-origin',
      });
      if (r.ok) {
        const d = (await r.json()) as { suggestions?: CommandSuggestion[] };
        const rows = Array.isArray(d.suggestions) ? d.suggestions : Array.isArray(d) ? d : [];
        const filtered = rows
          .map((row) => ({
            pattern: String(row.pattern || row.mapped_command || '').trim(),
            category: row.category ? String(row.category) : undefined,
          }))
          .filter((row) => row.pattern && !existingSet.has(row.pattern));
        setSuggestions(filtered.slice(0, 50));
        setSelected(new Set(filtered.slice(0, 15).map((row) => row.pattern)));
      } else {
        const fallback = STARTER_COMMAND_SUGGESTIONS.filter((c) => !existingSet.has(c));
        setSuggestions(fallback.map((pattern) => ({ pattern })));
        setSelected(new Set(fallback));
      }
    } catch {
      const fallback = STARTER_COMMAND_SUGGESTIONS.filter((c) => !existingSet.has(c));
      setSuggestions(fallback.map((pattern) => ({ pattern })));
      setSelected(new Set(fallback));
    } finally {
      setSuggestionsLoading(false);
    }
  }, [existingCommands.length, existingSet, workspaceId]);

  useEffect(() => {
    if (!suggestionsOpen || !showSuggestions) return;
    void loadSuggestions();
  }, [suggestionsOpen, showSuggestions, loadSuggestions]);

  useEffect(() => {
    if (!suggestionsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setSuggestionsOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [suggestionsOpen]);

  const toggleSelected = (pattern: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pattern)) next.delete(pattern);
      else next.add(pattern);
      return next;
    });
  };

  const handleAddSelected = () => {
    void (async () => {
      const toAdd = Array.from(selected).filter((c) => c.trim() && !existingSet.has(c.trim()));
      if (!toAdd.length) {
        setSuggestionsOpen(false);
        return;
      }
      setAddingBulk(true);
      try {
        if (onAddBulk) await onAddBulk(toAdd);
        setSuggestionsOpen(false);
      } finally {
        setAddingBulk(false);
      }
    })();
  };

  const suggestionsControl =
    showSuggestions && onAddBulk ? (
      <CommandSuggestionsPopover
        disabled={disabled}
        addingBulk={addingBulk}
        existingCommands={existingCommands}
        suggestionsOpen={suggestionsOpen}
        setSuggestionsOpen={setSuggestionsOpen}
        suggestionsLoading={suggestionsLoading}
        suggestions={suggestions}
        selected={selected}
        toggleSelected={toggleSelected}
        onAddSelected={handleAddSelected}
        popoverRef={popoverRef}
      />
    ) : null;

  return (
    <div className="flex flex-col gap-3">
      {hideLabel ? (
        suggestionsControl ? <div className="flex justify-end">{suggestionsControl}</div> : null
      ) : (
        <div className="flex items-center justify-between gap-2">
          {label ? (
            <div className="text-[12px] font-semibold text-main">{label}</div>
          ) : (
            <span />
          )}
          {suggestionsControl}
        </div>
      )}
      {hint ? <p className="text-[10px] text-muted -mt-1">{hint}</p> : null}
      <div className="flex gap-2">
        <input
          value={inputValue}
          disabled={disabled}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2 text-[12px] text-main disabled:opacity-40"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAdd()}
          className="px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-[11px] text-main hover:border-[var(--solar-cyan)]/50 disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {items.length === 0 ? (
        <div className="text-[12px] text-muted">None added yet</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <span key={item} className={chipClassName()}>
              <span className="truncate max-w-[16rem]">{item}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${item}`}
                onClick={() => onRemove(item)}
                className="p-0.5 rounded-full text-muted hover:text-[var(--color-danger)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                <X size={10} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
