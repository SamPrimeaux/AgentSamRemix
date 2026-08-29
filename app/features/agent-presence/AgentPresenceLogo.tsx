/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import type { AgentLogoMotion } from './presenceTypes';
import { presenceIconMarkup, presenceStateToIcon } from './presenceIcons';

const DEFAULT_LOGO =
  'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/ac515729-af6b-4ea5-8b10-e581a4d02100/thumbnail';

/** Static avatar when presence is idle (no active stream). */
export const AGENT_PRESENCE_IDLE_AVATAR =
  'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/11f6af46-0a3c-482a-abe8-83edc5a8a200/avatar';

function resolvePresenceVisualState(
  presenceState?: string,
  motion?: AgentLogoMotion,
): string {
  const ps = String(presenceState ?? 'idle').toLowerCase();
  const mo = String(motion ?? 'idle').toLowerCase();
  if (ps !== 'idle') return ps;
  if (mo !== 'idle') return mo;
  return 'idle';
}

export type AgentPresenceLogoProps = {
  motion: AgentLogoMotion;
  presenceState?: string;
  sizePx?: number;
  className?: string;
  src?: string;
  alt?: string;
  /** Use animated SVG from Loading States Lab (default true). */
  useSvgIcon?: boolean;
  /** Larger icon slot (54px base). */
  large?: boolean;
};

export const AgentPresenceLogo: React.FC<AgentPresenceLogoProps> = ({
  motion,
  presenceState,
  sizePx = 24,
  className = '',
  src = DEFAULT_LOGO,
  alt = 'Agent Sam',
  useSvgIcon = true,
  large = false,
}) => {
  const stateKey = resolvePresenceVisualState(presenceState, motion);
  const isIdle = stateKey === 'idle';
  const iconKey = presenceStateToIcon(stateKey);
  const iconHtml = useMemo(() => presenceIconMarkup(iconKey), [iconKey]);

  if (isIdle) {
    const avatarSrc = src !== DEFAULT_LOGO ? src : AGENT_PRESENCE_IDLE_AVATAR;
    return (
      <span
        className={`agent-sam-logo-wrap ${className}`}
        data-state="idle"
        aria-hidden={alt === ''}
      >
        <img
          src={avatarSrc}
          alt={alt}
          width={sizePx}
          height={sizePx}
          className="agent-sam-logo rounded-md object-cover"
          style={{ width: sizePx, height: sizePx }}
          draggable={false}
        />
      </span>
    );
  }

  return (
    <span
      className={`agent-sam-logo-wrap ${className}`}
      data-state={stateKey}
      aria-hidden={alt === ''}
    >
      {useSvgIcon ? (
        <span
          className={`iam-presence-icon-slot${large ? ' large' : ''}`}
          data-icon={iconKey}
          style={large ? undefined : { ['--size' as string]: `${sizePx}px` }}
          dangerouslySetInnerHTML={{ __html: iconHtml }}
        />
      ) : (
        <img
          src={src}
          alt={alt}
          width={sizePx}
          height={sizePx}
          data-motion={motion}
          className="agent-sam-logo"
          draggable={false}
        />
      )}
      <span className="agent-sam-logo-ring" aria-hidden />
    </span>
  );
};
