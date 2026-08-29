# auth-scaffold — identity app

Boring scaffold: **app/frontend** (auth UI) + **backend** (Worker API) + **migrations** (D1).

## Quick start

```bash
npm install
npx wrangler d1 create auth-scaffold
# paste database_id into wrangler.toml
npm run db:migrate:local
npm run dev
# open http://localhost:8787/auth/login
```

OAuth: minted `IAM_CLIENT_ID` + `IAM_CLIENT_SECRET` (default). Developer BYOK: `GOOGLE_*` / `GITHUB_*` when set.

## Layout

```
app/frontend/     Auth portal HTML + dashboard stub
backend/src/      Cloudflare Worker (identity routes)
migrations/       D1 schema (+ default `company` row)

Branding: `GET /api/company` (public). Update with `PATCH /api/company` when signed in.
```
