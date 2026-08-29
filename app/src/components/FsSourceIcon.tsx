import React from 'react';
import {
  FS_SOURCE_ICON_PX,
  type FsSourceIconId,
  FS_SOURCE_ICON_META,
} from '../lib/fsSourceIcons';

export type FsSourceIconProps = {
  id: FsSourceIconId;
  size?: number;
  className?: string;
  active?: boolean;
};

export const FsSourceIcon: React.FC<FsSourceIconProps> = ({
  id,
  size = FS_SOURCE_ICON_PX,
  className = '',
  active = false,
}) => {
  const meta = FS_SOURCE_ICON_META[id];
  return (
    <img
      src={meta.src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 object-contain pointer-events-none ${active ? 'opacity-100' : 'opacity-80'} ${className}`.trim()}
      aria-hidden
    />
  );
};

export function fsSourceTooltip(id: FsSourceIconId): string {
  return FS_SOURCE_ICON_META[id].title;
}
