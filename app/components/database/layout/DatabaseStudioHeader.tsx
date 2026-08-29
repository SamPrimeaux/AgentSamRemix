import React, { useMemo } from 'react';

import type { DatabaseD1Resource, DatabaseSupabaseProject } from '../hooks/useDatabaseResources';
import { DatabaseResourcePicker } from '../resources/DatabaseResourcePicker';
import {
  d1ResourceOptions,
  supabasePickerValue,
  supabaseResourceOptions,
  type PlatformSupabaseResource,
} from '../resources/databaseResourceOptions';

type Props = {
  onBackToOverview?: () => void;
  selectedTable: string | null;
  datasourceLabel: string;
  canWriteRows: boolean;
  showD1Picker: boolean;
  showSupabasePicker: boolean;
  d1ResourceRef: string;
  d1Resources: DatabaseD1Resource[];
  onSelectD1Resource: (nextRef: string) => void;
  isSuperadmin: boolean;
  studioSection: string;
  supabaseProjectRef: string;
  supabaseProjects: DatabaseSupabaseProject[];
  platformSupabase?: PlatformSupabaseResource | null;
  onSelectSupabaseResource: (next: string) => void;
};

export function DatabaseStudioHeader({
  onBackToOverview,
  selectedTable,
  datasourceLabel,
  canWriteRows,
  showD1Picker,
  showSupabasePicker,
  d1ResourceRef,
  d1Resources,
  onSelectD1Resource,
  isSuperadmin,
  studioSection,
  supabaseProjectRef,
  supabaseProjects,
  platformSupabase,
  onSelectSupabaseResource,
}: Props) {
  const d1Options = useMemo(() => d1ResourceOptions(d1Resources), [d1Resources]);
  const supabaseOptions = useMemo(
    () =>
      supabaseResourceOptions({
        isSuperadmin,
        platform: platformSupabase,
        projects: supabaseProjects,
      }),
    [isSuperadmin, platformSupabase, supabaseProjects],
  );

  return (
    <div className="flex flex-col gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-3">
        {onBackToOverview ? (
          <button
            type="button"
            onClick={onBackToOverview}
            className="shrink-0 text-[11px] font-semibold text-[var(--color-accent,var(--solar-cyan))] hover:underline"
          >
            ← Overview
          </button>
        ) : null}
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-semibold">{selectedTable || 'Query'}</p>
          <p className="truncate text-[11px] text-muted">
            {datasourceLabel}
            {!canWriteRows ? ' · read-only SQL' : ''}
          </p>
        </div>
      </div>
      {showD1Picker ? (
        <div className="w-full sm:w-auto">
          <DatabaseResourcePicker
            ariaLabel="Active D1 database"
            value={d1ResourceRef}
            options={d1Options}
            onChange={onSelectD1Resource}
            placeholder="Select database"
          />
        </div>
      ) : null}
      {showSupabasePicker ? (
        <div className="w-full sm:w-auto">
          <DatabaseResourcePicker
            ariaLabel="Active Supabase database"
            value={supabasePickerValue(studioSection, supabaseProjectRef)}
            options={supabaseOptions}
            onChange={onSelectSupabaseResource}
            placeholder="Select project"
          />
        </div>
      ) : null}
    </div>
  );
}
