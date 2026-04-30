---
name: web-dashboard-workflow
description: >-
  Delivers features and fixes in the vet-pharmacy web-dashboard (Vite React TS
  frontend, Node server, SQLite/Postgres, Supabase). Use for any task in this
  repo—new pages, API wiring, server routes, migrations, Supabase functions,
  deploy or env setup—when the user wants consistent execution and clear
  handoff summaries.
---

# web-dashboard workflow

## Before coding

1. Read the files that already implement the closest feature (page + `src/api/*` + server route if any).
2. Skim `src/types/api.ts` when the task touches API shapes.
3. If a dev server or long command might already run, check the terminals metadata folder before starting duplicates.

## Implementation habits

- Keep diffs minimal and on-request; extend existing patterns (React Query hooks, modal components, PDF helpers in `src/lib/`, etc.).
- Put API calls in `src/api/` and keep components thin unless the file already does otherwise.
- For DB changes, add a migration under `server/migrations/` and keep server DB access aligned with existing `server/db.js` / `server/pgdb.js` usage.

## Supabase and secrets

- Do not commit real keys. Use `.env.example` for documented placeholders; local secrets belong in `.env.local` (or the user’s chosen local env file).
- For Supabase-specific behavior, read `SUPABASE_SETUP.md` and `supabase/functions/` before inventing new endpoints.

## Verification

- Run `npm run lint` after non-trivial TS/JS changes when possible.
- For UI changes, sanity-check the affected route or flow if a browser or MCP browser tool is available.

## How to report back

- Summarize what changed and why in plain language (not a raw file list).
- Mention commands run and their outcome when relevant (e.g. lint clean, build failed with error X).
- If something is left for the user (env vars, deploy credentials), list it explicitly once under a short “You’ll need to” section.
