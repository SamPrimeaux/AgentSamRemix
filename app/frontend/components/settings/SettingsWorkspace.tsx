import React from 'react';
import { Filter, KeyRound, Settings, X } from 'lucide-react';
import { KeysSettings } from './KeysSettings';
import { IndexRulesSettings } from './IndexRulesSettings';
import './settings.css';

export type SettingsSection = 'keys' | 'indexrules';

interface Props {
  section: SettingsSection;
  onNavigate: (section: SettingsSection) => void;
  onClose: () => void;
}

export const SettingsWorkspace: React.FC<Props> = ({ section, onNavigate, onClose }) => {
  return (
    <div className="as-settings-shell">
      <header className="as-settings-topbar">
        <div><Settings size={16} /><strong>SETTINGS</strong></div>
        <button type="button" onClick={onClose} aria-label="Close settings"><X size={17} /></button>
      </header>
      <div className="as-settings-body">
        <aside className="as-settings-nav">
          <div className="as-settings-nav-title">Agent Sam</div>
          <button type="button" className={section === 'keys' ? 'active' : ''} onClick={() => onNavigate('keys')}><KeyRound size={16} /><span><strong>Keys &amp; Secrets</strong><small>BYOK and vault</small></span></button>
          <button type="button" className={section === 'indexrules' ? 'active' : ''} onClick={() => onNavigate('indexrules')}><Filter size={16} /><span><strong>Index Rules</strong><small>Repository policy</small></span></button>
          <div className="as-settings-nav-note">These screens use the same D1 and vault authorities as the runtime. They are not preference-only mockups.</div>
        </aside>
        <main className="as-settings-main">{section === 'keys' ? <KeysSettings /> : <IndexRulesSettings />}</main>
      </div>
    </div>
  );
};

export default SettingsWorkspace;
