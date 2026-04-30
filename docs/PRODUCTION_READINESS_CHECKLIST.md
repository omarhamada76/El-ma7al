# Production Readiness Report

## 1) Pre-Deploy Checklist (must pass)

- **Edge function auth mode**
  - Keep deployed with `--no-verify-jwt` (function handles public/protected routes internally).
- **Supabase Edge secrets**
  - `DB_URL`
  - `JWT_SECRET`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- **Frontend env**
  - `VITE_API_ORIGIN=https://durlemdvxspirzgdywwk.supabase.co/functions/v1/api`
- **Auth data**
  - Target production users must exist in `auth.users` (and identity row).
- **Data safety**
  - Do not run test-data cleanup in production unless intentional.
- **Build**
  - `npm run build` passes.

## 2) Deployment Steps (safe order)

1. Deploy Edge API:
   - `supabase functions deploy api --project-ref durlemdvxspirzgdywwk --no-verify-jwt`
2. Build frontend:
   - `npm run build`
3. Deploy frontend hosting (Netlify/Firebase/your normal path).
4. Hard refresh browser after release (`Cmd+Shift+R`).

## 3) Smoke Test Script

```bash
BASE="https://durlemdvxspirzgdywwk.supabase.co/functions/v1/api"
EMAIL="omar.dev.me@gmail.com"
PASS="GG7G10##ggg"

TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);process.stdout.write(j.accessToken||'')})")

echo "token_ok=$([ -n "$TOKEN" ] && echo yes || echo no)"

curl -s -H "Authorization: Bearer $TOKEN" "$BASE/auth/me"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/clients?limit=5"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/suppliers?limit=5"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/products?limit=5"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/invoices?limit=5"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/settings"
```

Pass criteria:
- login returns token
- endpoints return JSON without `401`/`500`

## 4) Rollback Notes (fast recovery)

- **If frontend release breaks UI only**: rollback frontend deploy only.
- **If API release breaks behavior**:
  - redeploy last known good `api` function version,
  - hard refresh client cache.
- **If auth breaks**:
  - verify target users exist in `auth.users`,
  - verify Edge secrets are present,
  - retest `/auth/login` and `/auth/status`.

## 5) Stabilization Status (already done)

- Removed legacy localhost fallback from Edge API.
- Fixed list/detail consistency for clients, suppliers, products.
- Normalized numeric rendering (no noisy trailing `.0000` in UI).
- Expiry UX standardized to month/year where applicable.
- Improved user-facing error messages from backend responses.
