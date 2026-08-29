import React, { useMemo } from 'react';
import {
  monacoLanguageIdFromFilename,
  resolveSetiGlyph,
  type SetiResolveInput,
} from '../lib/setiFileIcon';

export type SetiFileIconProps = {
  filename: string;
  languageId?: string | null;
  size?: number;
  className?: string;
  title?: string;
};

/**
 * Cursor/VS Code Seti file glyph — per-extension/language badge (JS, TS, shell, etc.).
 */
export const SetiFileIcon: React.FC<SetiFileIconProps> = ({
  filename,
  languageId,
  size = 14,
  className = '',
  title,
}) => {
  const glyph = useMemo(() => {
    const input: SetiResolveInput = {
      filename,
      languageId: languageId ?? monacoLanguageIdFromFilename(filename),
    };
    return resolveSetiGlyph(input);
  }, [filename, languageId]);

  return (
    <span
      className={`seti-file-icon ${className}`.trim()}
      style={{
        color: glyph.color,
        fontSize: `${Math.round(size * 1.35)}px`,
        width: size,
        height: size,
      }}
      title={title ?? `${glyph.iconKey} · ${filename}`}
      aria-hidden
    >
      {glyph.char}
    </span>
  );
};
