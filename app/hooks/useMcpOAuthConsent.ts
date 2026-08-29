/**
 * useMcpOAuthConsent.ts
 *
 * Reads ?authorization_id= from the URL and exposes it for
 * IamMcpOAuthConsentPage. Place in app/dashboard/components/auth/ alongside
 * the page component.
 *
 * Usage:
 *   const { authorizationId } = useMcpOAuthConsent();
 *   return <IamMcpOAuthConsentPage authorizationId={authorizationId} />;
 */

import { useMemo } from "react";

export interface McpOAuthConsentParams {
  /** oaa_* from ?authorization_id= query param, or undefined if missing */
  authorizationId: string | undefined;
  /** true while we can't derive a valid id */
  isMissing: boolean;
}

export function useMcpOAuthConsent(): McpOAuthConsentParams {
  const authorizationId = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("authorization_id") ?? undefined;
    // Enforce oaa_ prefix — reject stale Supabase UUIDs accidentally hitting this route
    if (raw && !raw.startsWith("oaa_")) {
      console.warn("[MCP OAuth] authorization_id does not start with oaa_ — ignoring:", raw);
      return undefined;
    }
    return raw;
  }, []);

  return { authorizationId, isMissing: !authorizationId };
}
