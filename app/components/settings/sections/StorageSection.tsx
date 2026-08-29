import React from 'react';
import { StorageSettingsPanel } from '../StorageSettingsPanel';

export type StorageSectionProps = Record<string, never>;

export function StorageSection() {
  return <StorageSettingsPanel />;
}
