import React from 'react';
import { CodeXml, Globe, Image as ImageIcon } from 'lucide-react';
import { StartupChipRow } from '../../shell/chat-startup/StartupChipRow';

export type ComposerStartupChipsProps = {
  className?: string;
  onCreateImage: () => void;
  onWebSearch: () => void;
  onOpenEditor: () => void;
};

export function ComposerStartupChips({
  className,
  onCreateImage,
  onWebSearch,
  onOpenEditor,
}: ComposerStartupChipsProps) {
  return (
    <StartupChipRow
      className={className}
      ariaLabel="Quick actions"
      chips={[
        { id: 'image', label: 'Create an image', icon: ImageIcon, onClick: onCreateImage },
        { id: 'web', label: 'Web search', icon: Globe, onClick: onWebSearch },
        { id: 'editor', label: 'Open editor', icon: CodeXml, onClick: onOpenEditor },
      ]}
    />
  );
}

export function ComposerStartupGreeting({ isDarkTheme }: { isDarkTheme: boolean }) {
  return (
    <div className="iam-chat-startup-greeting">
      <img
        src={
          isDarkTheme
            ? 'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/dbb316af-9c97-4959-f09f-bf58b2783d00/avatar'
            : 'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/11f6af46-0a3c-482a-abe8-83edc5a8a200/avatar'
        }
        alt="Inner Animal Media"
        width={72}
        height={72}
      />
      <p className="text-[15px] font-semibold text-[var(--dashboard-text)]">What should we work on?</p>
      <p className="text-[12px] text-[var(--dashboard-muted)] leading-relaxed max-w-sm">
        Type below to start a conversation with Agent Sam.
      </p>
    </div>
  );
}
