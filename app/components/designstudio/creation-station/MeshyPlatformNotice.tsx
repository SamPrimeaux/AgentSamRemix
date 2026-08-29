import React from 'react';
import { Link } from 'react-router-dom';

const KEYS_PATH = '/dashboard/settings/keys';

type Props = {
  stub?: boolean;
  lowCredits?: boolean;
  className?: string;
};

/** Platform Meshy key messaging — BYOK lives in Settings → Keys, not Design Studio. */
export function MeshyPlatformNotice({ stub, lowCredits, className = '' }: Props) {
  if (!stub && !lowCredits) return null;
  return (
    <p
      className={`text-[11px] rounded-lg px-3 py-2 border leading-relaxed ${className}`}
      style={{
        color: 'var(--text-main)',
        background: 'color-mix(in srgb, var(--solar-yellow) 12%, transparent)',
        borderColor: 'color-mix(in srgb, var(--solar-yellow) 35%, transparent)',
      }}
    >
      {stub ? (
        <>
          Platform Meshy is not configured on this Worker. Generation uses the org{' '}
          <code className="text-[10px] font-mono">MESHYAI_API_KEY</code> by default — contact your
          admin, or add your own key in{' '}
          <Link to={KEYS_PATH} className="text-[var(--solar-cyan)] hover:underline font-semibold">
            Settings → Keys
          </Link>
          .
        </>
      ) : (
        <>
          Meshy credits may be low. Add a personal key in{' '}
          <Link to={KEYS_PATH} className="text-[var(--solar-cyan)] hover:underline font-semibold">
            Settings → Keys
          </Link>{' '}
          to avoid platform quota limits.
        </>
      )}
    </p>
  );
}

export { KEYS_PATH };
