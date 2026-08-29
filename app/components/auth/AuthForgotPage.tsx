import React, { useEffect } from 'react';

/** Legacy SPA route — canonical password reset is /auth/reset (R2 shell). */
export function AuthForgotPage() {
  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get('next');
    const dest = next && next.startsWith('/') && !next.startsWith('//')
      ? `/auth/reset?next=${encodeURIComponent(next)}`
      : '/auth/reset';
    window.location.replace(dest);
  }, []);

  return null;
}
