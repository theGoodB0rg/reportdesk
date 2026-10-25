# Runbook

## Run locally

```bash
npm install
npm run seed        # builds data/erp.db and data/app.db (synthetic, deterministic)
npm run dev         # http://127.0.0.1:8787
npm test
```

Without `OPENROUTER_API_KEY`, everything works except free-form questions in "Ask"; the five example questions still answer.

## Configuration

All configuration is environment variables, validated at startup by `src/config`. A bad value fails fast with the variable's name (never its value). See `.env.example` for the full list.

| Variable | Purpose | Secret |
|---|---|---|
| `OPENROUTER_API_KEY` | Enables free-form ask-your-data | **Yes** |
| `OPENROUTER_MODEL` | Model id | No |
| `ERP_DB_PATH` / `APP_DB_PATH` | SQLite files | No |
| `QUERY_ROW_LIMIT` | Max rows any generated query may return | No |
| `AS_OF` | The demo's fixed "today" | No |
| `SLACK_WEBHOOK_URL` | Digest delivery | **Yes** |

## Secrets

- Local: put them in `.env` (gitignored). Never in code, `.env.example`, or `wrangler.toml`.
- Cloudflare: `npx wrangler secret put OPENROUTER_API_KEY`.
- GitHub Actions: repository secret `SLACK_WEBHOOK_URL`.
- CI runs gitleaks over full history on every push.
- **If a key leaks:** revoke it in the OpenRouter dashboard first, then create a new one, then clean the history if it was committed.

## Add a report

1. Add an entry to `REPORTS` in `src/reports/index.ts` (id, title, SQL, keywords).
2. That is all: the tests automatically check it runs, returns rows, and passes the SQL guard; triage, the API, the CSV export and the digest pick it up.

## Change the database engine

Everything depends on the `Database` interface (`src/db/types.ts`): `query` and `run`. To move to Postgres, write an adapter that implements it, then review the few SQLite-specific functions in the reports (`strftime`, `julianday`, `date`) and in `SCHEMA_DOC`. The SQL guard's structure is dialect-neutral but its forbidden-keyword list should be reviewed for the new engine.

For a real deployment, point the ERP connection at a **read replica** with a database user that has `SELECT` on the approved tables only. The in-app guard is a second layer, not a replacement for database permissions.

## Deploy to Cloudflare (untested by the author)

The Worker, D1 adapter and `wrangler.toml` are written and the handler they wrap is covered by tests, but this deployment path has not been run end to end.

```bash
npx wrangler d1 create reportdesk-erp      # paste ids into wrangler.toml
npx wrangler d1 create reportdesk-app
npm run export:d1                          # writes d1/erp.sql and d1/app.sql
npx wrangler d1 execute reportdesk-erp --remote --file=d1/erp.sql
npx wrangler d1 execute reportdesk-app --remote --file=d1/app.sql
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler deploy
```

D1 has no per-user read-only mode, so on that deployment read-only enforcement is the `readOnly()` wrapper plus the SQL guard. The Node/SQLite path additionally gets SQLite's own read-only open.

## Failure modes

| Symptom | Likely cause | What to do |
|---|---|---|
| Ask returns "AI assistant is not configured" | No key set | Set `OPENROUTER_API_KEY`, or use the example questions |
| Ask returns "AI service is unavailable" | Provider error, quota or timeout | Check the OpenRouter dashboard; cached examples still work |
| Ask returns a guard rejection | Model produced unsafe or off-schema SQL | Expected behaviour; review `audit_log` if frequent and tighten the prompt |
| HTTP 429 | Rate limit (20 requests/minute per client) | Wait a minute |
| HTTP 500 "Internal error" | Unexpected failure | Detail is in the server log, deliberately not in the response |
| Weekly digest not delivered | Missing or invalid `SLACK_WEBHOOK_URL` | The Actions artifact is still produced; fix the secret |
