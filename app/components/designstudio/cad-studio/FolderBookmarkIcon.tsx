import React from 'react';

type FolderBookmarkIconProps = {
  size?: number;
  stroke?: string;
  className?: string;
};

/** Folder-bookmark icon for lazy asset library toggle on entry screen. */
export function FolderBookmarkIcon({
  size = 22,
  stroke = '#04a9fb',
  className,
}: FolderBookmarkIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 6v8l3-3 3 3V6" />
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" />
    </svg>
  );
}
