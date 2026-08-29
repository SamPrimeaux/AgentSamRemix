import IamMcpOAuthConsentPage from "./IamMcpOAuthConsentPage";
import { useMcpOAuthConsent } from "../../hooks/useMcpOAuthConsent";

/** Standalone MCP OAuth consent — no dashboard shell. */
export default function MountIamMcpConsent() {
  const { authorizationId, isMissing } = useMcpOAuthConsent();
  return (
    <IamMcpOAuthConsentPage authorizationId={isMissing ? undefined : authorizationId} />
  );
}
