# Lane B — HTTP settings identity assumptions (Lane A must preserve)

- `src/index.js` primes `authCtx` via `primeRequestAuth` before domain dispatch.
- `dispatchBackendHttpRoutes` / `dispatchSettingsHttpRoutes` receive `{ authCtx, authUser }` — **no second** `getAuthUser()` or `resolveIdentity()` inside settings handlers.
- Portable contract: `backend/identity/contracts/identity-context.js` → `identityContextFromAuthContext(authCtx)`.
- Lane A must keep `authContextToLegacyUser` stable for `authUser` derivation at the HTTP boundary.
