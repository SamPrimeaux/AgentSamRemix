import React, { useMemo, useState } from 'react';
import { Stream } from '@cloudflare/stream-react';

/**
 * Extract Stream customer code from `customer-<CODE>.cloudflarestream.com`
 * (or a bare CODE). Required by `@cloudflare/stream-react`.
 */
export function streamCustomerCodeFromHost(hostOrCode?: string | null): string | null {
  const raw = String(hostOrCode || '').trim();
  if (!raw) return null;
  const hostMatch = raw.match(/^customer-([^.]+)\.cloudflarestream\.com$/i);
  if (hostMatch) return hostMatch[1];
  if (/^[a-z0-9]+$/i.test(raw)) return raw;
  return null;
}

export type StreamPlayerEmbedProps = {
  /** Video UID or signed token. */
  src: string;
  /** Full host (`customer-….cloudflarestream.com`) or bare customer code. */
  customerSubdomain?: string | null;
  controls?: boolean;
  muted?: boolean;
  autoplay?: boolean;
  loop?: boolean;
  primaryColor?: string;
  poster?: string;
  startTime?: string | number;
  requireSignedUrls?: boolean;
  title?: string;
  className?: string;
};

/**
 * Official Cloudflare Stream React player (`@cloudflare/stream-react`).
 * Prefer this over hand-rolled iframes for dashboard previews.
 */
export function StreamPlayerEmbed({
  src,
  customerSubdomain,
  controls = true,
  muted = false,
  autoplay = false,
  loop = false,
  primaryColor,
  poster,
  startTime,
  requireSignedUrls = false,
  title = 'Stream preview',
  className,
}: StreamPlayerEmbedProps) {
  const [playError, setPlayError] = useState<string | null>(null);
  const customerCode = useMemo(
    () => streamCustomerCodeFromHost(customerSubdomain),
    [customerSubdomain],
  );
  const videoSrc = String(src || '').trim();

  if (!videoSrc) {
    return (
      <PlayerFallback>
        Missing video id — cannot initialize Stream player.
      </PlayerFallback>
    );
  }

  if (!customerCode) {
    return (
      <PlayerFallback>
        {requireSignedUrls
          ? 'Signed URLs enabled — need a signed token + customer code to embed.'
          : 'Customer subdomain not ready yet — wait for Stream playback.hls.'}
      </PlayerFallback>
    );
  }

  return (
    <div className={className} style={{ width: '100%', background: '#000' }}>
      {playError ? (
        <div
          style={{
            padding: '10px 12px',
            fontSize: 11,
            color: '#fecaca',
            background: '#7f1d1d',
            lineHeight: 1.4,
          }}
        >
          {playError}
        </div>
      ) : null}
      <Stream
        src={videoSrc}
        customerCode={customerCode}
        controls={controls}
        muted={muted}
        autoplay={autoplay}
        loop={loop}
        primaryColor={primaryColor}
        poster={poster}
        startTime={startTime}
        responsive
        title={title}
        onError={() => {
          setPlayError(
            requireSignedUrls
              ? 'Playback failed — this video requires a signed token (Require signed URLs is on).'
              : 'Stream player error — video may still be encoding, or the embed token/host is invalid.',
          );
        }}
      />
    </div>
  );
}

function PlayerFallback({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        aspectRatio: '16 / 9',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        color: '#f87171',
        fontSize: 12,
        textAlign: 'center',
        lineHeight: 1.45,
        background: '#000',
      }}
    >
      {children}
    </div>
  );
}

export default StreamPlayerEmbed;
