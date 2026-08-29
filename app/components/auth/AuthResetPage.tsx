import React, { useEffect } from 'react';

/** Legacy SPA route — canonical password reset is /auth/reset (R2 shell). */
export function AuthResetPage() {
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const next = qs.get('next');
    const dest = next && next.startsWith('/') && !next.startsWith('//')
      ? `/auth/reset?next=${encodeURIComponent(next)}`
      : '/auth/reset';
    window.location.replace(dest);
  }, []);

  return null;
}
