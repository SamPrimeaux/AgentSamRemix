import { ClipboardText } from '@cloudflare/kumo/components/clipboard-text';

export type ClipboardFieldProps = {
  label?: string;
  text: string;
  textToCopy?: string;
  size?: 'sm' | 'base' | 'lg';
  className?: string;
};

export function ClipboardField({ label, text, textToCopy, size = 'base', className = '' }: ClipboardFieldProps) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${className}`.trim()}>
      {label ? <span className="text-xs font-medium text-kumo-subtle">{label}</span> : null}
      <ClipboardText
        size={size}
        text={text}
        textToCopy={textToCopy}
        tooltip={{ text: 'Copy', copiedText: 'Copied!', side: 'top' }}
      />
    </label>
  );
}
