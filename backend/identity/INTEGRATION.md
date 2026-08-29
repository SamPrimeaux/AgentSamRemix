# AgentSamRemix Identity Kernel

This directory is the proving ground for the portable Inner Animal Media
identity substrate.

## Authority

- `contracts/` — transport-independent identity shapes and laws.
- `oauth/` — encrypted inbound/integration credential storage and refresh.
- Agent Sam SDK currently owns browser login/session transport.
- `user_oauth_tokens` stores credential material; it is not request auth.
- JWTs prove identity/session/workspace pins only. Tool authorization does not
  belong in JWT claims.

## Supported providers

Login:
- Google
- GitHub
- IAM
- email/password

Stored OAuth credentials:
- Google / Drive / Gmail / Calendar
- GitHub / GitHub App
- Cloudflare
- IAM

Supabase is intentionally not part of AgentSamRemix.

## Graduation rule

Code graduates back to InnerAnimalMedia only after it:
1. builds in the Remix Worker,
2. has no `src/`, dashboard, or integrations-domain dependency,
3. uses canonical `auth_users.id`,
4. keeps authorization out of transport JWTs,
5. preserves encrypted-at-rest OAuth tokens.
