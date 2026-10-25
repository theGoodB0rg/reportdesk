# Runbook

## Run locally

```bash
npm install
npm run seed        # builds data/erp.db and data/app.db (synthetic, deterministic)
npm run dev         # http://127.0.0.1:8787
npm test
```

Without `OPENROUTER_API_KEY`, everything works except the assistant and free-form questions in "Ask"; the five example questions still answer.

## Configuration

All configuration is environment variables, validated at startup by `src/config`. A bad value fails fast with the variable's name (never its value). See `.env.example` for the full list.

| Variable | Purpose | Secret |
|---|---|---|
| `OPENROUTER_API_KEY` | Enables the assistant and free-form questions | **Yes** |
| `OPENROUTER_MODEL` | Model id | No |
| `ERP_DB_PATH` / `APP_DB_PATH` | SQLite files (local) | No |
| `QUERY_ROW_LIMIT` | Max rows any generated query may return | No |
| `AS_OF` | The demo's fixed "today" | No |
| `PUBLIC_DEMO` | `true` on a public deployment: requests are answered but not stored | No |
| `AI_DAILY_BUDGET` | Cap on model calls per day, across all visitors | No |
| `AI_CLIENT_DAILY_BUDGET` | Cap on model calls per day, per visitor | No |
| `SLACK_WEBHOOK_URL` | Digest delivery | **Yes** |

## Secrets

- Local: put them in `.env` (gitignored). Never in code, `.env.example`, or `wrangler.toml`.
- Cloudflare: `npx wrangler secret put OPENROUTER_API_KEY`.
- GitHub Actions: repository secret `SLACK_WEBHOOK_URL`.
- CI runs gitleaks over full history on every push.
- **Rotate or revoke:** create the new key in the OpenRouter dashboard, `wrangler secret put` it, then revoke the old one. To switch the AI off immediately, `npx wrangler secret delete OPENROUTER_API_KEY`; the rest of the app keeps working.

## Deploy to Cloudflare

The project runs as one Worker (API plus static assets) with two D1 databases: `ERP` (the data, accessed read-only) and `APP` (request log, audit log and the AI budget counters).

```bash
npx wrangler login
npx wrangler d1 create reportdesk-erp      # paste both database ids into wrangler.toml
npx wrangler d1 create reportdesk-app
npm run export:d1                          # writes d1/erp.sql and d1/app.sql
npx wrangler d1 execute reportdesk-erp --remote --file=d1/erp.sql
npx wrangler d1 execute reportdesk-app --remote --file=d1/app.sql
npx wrangler deploy
npx wrangler secret put OPENROUTER_API_KEY # a Worker must exist before it can hold a secret
```

If your login covers several Cloudflare accounts, set `CLOUDFLARE_ACCOUNT_ID` for each command, or `account_id` in `wrangler.toml`.

D1 has no per-user read-only mode, so read-only access there is the `readOnly()` wrapper plus the SQL guard. Locally, SQLite is additionally opened read-only.

## Public demo safeguards

A public deployment spends real money through one API key, so cost is bounded in advance:

- **Daily budget.** Every model call spends from `AI_DAILY_BUDGET` (all visitors) and `AI_CLIENT_DAILY_BUDGET` (per visitor), counted atomically in D1. The worst-case daily spend is therefore fixed: calls per day times your model's per-call cost, which the OpenRouter dashboard shows. Both caps reset at midnight UTC. Change them in `wrangler.toml` and redeploy.
- **What visitors see at the cap.** A plain message; reports, the example questions and reconciliation keep working.
- **Rate limit.** A Cloudflare limiter per client (`[[ratelimits]]` in `wrangler.toml`) acts as a coarse flood brake; it is approximate by design, so the exact guarantees come from the budget above.
- **Nothing is stored from visitors** (`PUBLIC_DEMO=true`), and visitors are counted by a one-way daily hash, not their address.
- **Look at usage:** `npx wrangler d1 execute reportdesk-app --remote --command "SELECT key, count FROM usage"`, and the `audit_log` table for every generated query and why any AI call failed.

## Add a report

1. Add an entry to `REPORTS` in `src/reports/index.ts` (id, title, SQL, keywords).
2. That is all: the tests automatically check it runs, returns rows, and passes the SQL guard; triage, the API, the CSV export and the digest pick it up.

## Change the database engine

Everything depends on the `Database` interface (`src/db/types.ts`): `query` and `run`. To move to Postgres, write an adapter that implements it, then review the few SQLite-specific functions in the reports (`strftime`, `julianday`, `date`) and in `SCHEMA_DOC`. The SQL guard's structure is dialect-neutral but its forbidden-keyword list should be reviewed for the new engine.

For a real deployment, point the ERP connection at a **read replica** with a database user that has `SELECT` on the approved tables only. The in-app guard is a second layer, not a replacement for database permissions.

## Failure modes

| Symptom | Likely cause | What to do |
|---|---|---|
| "The AI assistant is not configured" | No key set | Set `OPENROUTER_API_KEY`, or use the example questions |
| "The AI service is unavailable" | Provider error, quota or timeout | Check the `audit_log` reason (for example `HTTP 401` means a bad key) and the OpenRouter dashboard; cached examples still work |
| "You've reached today's AI limit" / "budget … used up" | A daily cap was reached | Expected; resets at midnight UTC. Raise `AI_DAILY_BUDGET` or `AI_CLIENT_DAILY_BUDGET` if intended |
| A guard rejection | Model produced unsafe or off-schema SQL | Expected behaviour; review `audit_log` if frequent and tighten the prompt |
| HTTP 429 | Rate limit | Wait a minute |
| HTTP 413 | Request body over the cap | Send a smaller request |
| HTTP 500 "Internal error" | Unexpected failure | Detail is in the Worker log, deliberately not in the response |
| Weekly digest not delivered | Missing or invalid `SLACK_WEBHOOK_URL` | The Actions artifact is still produced; fix the secret |
