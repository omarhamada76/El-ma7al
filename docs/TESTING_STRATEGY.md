# Testing Strategy

This project uses two layers of tests:

1. Unit tests (`jest`) for deterministic business logic.
2. End-to-end tests (`playwright`) for full UI + API flows.

## Commands

- `npm run test:unit`: run unit tests.
- `npm run test:e2e`: run Playwright tests in safe mode (`STAGING_MODE=true`).
- `npm run test:all`: run unit + e2e.

## What unit tests cover

- Financial calculations in `server/lib/financials.ts`.
- Inventory deduction/safety/expiry logic in `server/lib/inventory.ts`.
- Role/permission guards in `src/lib/roles.ts`.
- Barcode and scan parsing edge cases in `src/lib/barcodeLookup.ts` and `src/lib/scanCodes.ts`.

## What e2e tests cover

- Sales and payment flows.
- Billing cycle behavior.
- Staff restrictions in UI.
- Barcode scanning behavior.

## Safe execution rules

- Do not run e2e against production data.
- Keep `.env`/`VITE_API_ORIGIN` pointing to staging/test backend before `npm run test:e2e`.
- Playwright config intentionally requires `STAGING_MODE=true` so tests are not accidentally run against live data.

## Recommended CI pipeline

1. `npm ci`
2. `npm run lint`
3. `npm run test:unit`
4. (staging only) `npm run test:e2e`
