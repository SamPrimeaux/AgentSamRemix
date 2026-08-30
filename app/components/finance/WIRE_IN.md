# Finance Dashboard — Wire-in Instructions for Cursor
# Apply these two surgical edits after dropping the `finance/` folder into
# `app/components/finance/`.
#
# DO NOT touch billing.js, overview-bundle.js, cron/, or existing finance.js handlers.

## 1. app/App.tsx — Add lazy route

Find the existing lazy import block (where Overview is imported) and add:

```tsx
const FinanceDashboard = lazy(() => import('./components/finance'));
```

Find the <Routes> block and add alongside the Overview route:

```tsx
<Route path="/dashboard/finance" element={<FinanceDashboard />} />
```

## 2. Sidebar nav — Add Finance link

Find where the Overview nav item is rendered in the sidebar component
(look for `navigate('/dashboard/overview')` or similar).

Add a Finance item in the same pattern:

```tsx
{
  label: 'Finance',
  icon: <BarChart2 size={18} />,   // or whichever icon matches adjacent items
  path: '/dashboard/finance',
}
```

Or inline JSX if the sidebar uses direct button elements:

```tsx
<button
  onClick={() => navigate('/dashboard/finance')}
  className={navItemClass('/dashboard/finance')}
  title="Finance"
>
  <BarChart2 size={18} />
  <span>Finance</span>
</button>
```

## 3. Worker — Ensure /dashboard/finance serves the SPA shell

In src/index.js (or wherever dashboard routes are handled), confirm that
`/dashboard/finance` falls through to serving the SPA shell (same as
`/dashboard/overview`). If there is a `finance.html` static fallback on R2
that conflicts, it should be removed or redirected.

Typical pattern to verify / add if missing:

```js
// In the route handler that serves dashboard pages
if (path.startsWith('/dashboard/') && !path.includes('.')) {
  // serve app/index.html (SPA shell) — already handled if overview works
}
```

## 4. Build + Deploy

```bash
npm run build             # verify clean Vite build
bin/agentsam deploy fast  # build + deploy through the repository lane
```

Then validate: load /dashboard/finance while logged in.
Network tab should show:
  - GET /api/finance/summary        → 200
  - GET /api/finance/spend-by-model → 200
  - GET /api/finance/spend-by-day   → 200
  - GET /api/finance/budgets        → 200
  - GET /api/finance/alerts         → 200

## 5. Import path note

All files use:
  import { cn } from '../../../lib/utils';   (panels → finance → components → lib)
  or
  import { cn } from '../../lib/utils';      (index.tsx → components → lib)

If your lib/utils path differs, do a find-replace on the import paths.

## 6. TransactionsTable import fix

TransactionsTable.tsx has a duplicate import at the top that should be cleaned:

Remove:
  import { fmt, addTransaction as apiAdd } from '../hooks/useFinanceData';

Keep:
  import { addTransaction } from '../hooks/useFinanceData';

(The `apiAdd` alias is unused — it was left as a placeholder. Cursor should
remove the first import line.)
