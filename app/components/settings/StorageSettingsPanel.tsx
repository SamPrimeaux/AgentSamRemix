import React from 'react';
import { StoragePage } from '../StoragePage';

export type StorageSettingsPanelProps = Record<string, never>;

export function StorageSettingsPanel(_props: StorageSettingsPanelProps) {
  return <StoragePage embeddedInSettings />;
}

