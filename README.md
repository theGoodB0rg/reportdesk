# ReportDesk

AI-assisted reporting automation for a business whose reporting requests all land on IT.

A department asks for a number or a briefing. Instead of a ticket, an **AI analyst** runs the right reports and queries, reads the results, and writes the answer, including a draft email for a person to review. Simpler requests are **triaged** to a saved report or a guarded natural-language query, reports run **on a schedule**, and a **reconciliation** compares the ERP with a second system.

> Everything runs on **synthetic data** (a generated mock ERP). No real company, customer or invoice appears anywhere.

![A 48-second walkthrough: overview, the AI assistant preparing a collections briefing and email draft, reports, ask-your-data, request desk, reconciliation and impact](docs/video/walkthrough.gif)

*48-second walkthrough (sped up 1.5x; the real recording, [`docs/video/walkthrough.mp4`](docs/video/walkthrough.mp4), is 72 seconds and includes the live model's thinking time).*

## The assistant

![The AI assistant preparing a collections briefing: it pulled KPIs, ran a report, wrote the briefing with exact figures, and drafted an email marked "Draft, not sent"](docs/screenshots/02-assistant.png)

Ask for a briefing, a check, or a draft. The model decides which tools to call, in what order, and writes the answer from what comes back. Every step it took is shown with the answer, and any SQL it wrote is one click away.

| Tool the model can call | What it does |
|---|---|
| `get_kpis` | Headline receivables, revenue, stock and purchasing numbers |
| `run_saved_report` | Runs one of the six saved reports |
| `run_sql` | Runs a read-only query for anything the reports do not cover, after the SQL guard |
| `check_reconciliation` | Compares every ERP invoice with the billing export |
| `draft_email` | Writes a draft. **It cannot send anything.** A person reviews and sends |

That is the whole list. There is no tool that writes to the ERP or sends a message, which is deliberate: the assistant earns more autonomy by being reliable at reading first (see [`docs/agentic-roadmap.md`](docs/agentic-roadmap.md)).

## Screenshots

**Overview.** Headline receivables, revenue and supply KPIs, each linking to the report behind it.
![Operations overview](docs/screenshots/01-overview.png)

**Saved reports.** Sortable, searchable, paginated tables with currency formatting, data bars and CSV export for Excel, Power BI or Tableau.
![Saved reports](docs/screenshots/03-reports.png)

**Ask your data.** A plain-English question becomes a checked, read-only query. The SQL that ran is one click away.
![Ask your data](docs/screenshots/04-ask-your-data.png)

**Request desk.** Each request is triaged to a report, a generated query, or IT, with the reasoning shown.
![Request desk](docs/screenshots/05-request-desk.png)

**Reconciliation.** ERP invoices compared with the billing export, filterable by issue type.
![Reconciliation](docs/screenshots/06-reconciliation.png)

**Impact.** Self-service vs. IT load, with the assumptions stated on the page.
![Automation impact](docs/screenshots/07-impact.png)

**Dark theme.**
![Overview in the dark theme](docs/screenshots/08-overview-dark.png)

Charts follow a colour palette validated for colour-blind readers, every chart has a "View as table" twin, and the interface is built for keyboard use (skip link, visible focus, labelled controls, tables with announced sort state). It has not been through a formal accessibility audit.

## How it fits together

```
 Request ──► Assistant (tool-calling) ──► reports / guarded SQL / reconciliation ──► briefing + draft email
        └──► Triage ─► Saved report | Ask your data | Escalate to IT (with a reason, logged)

 Schedule (GitHub Actions) ─► all reports + reconciliation ─► digest (artifact / Slack)
```

## What it demonstrates

| A reporting-automation role needs | Where it is here |
|---|---|
| Hands-on AI that connects to the ERP, database and reporting tools | `src/assistant` (tool-calling analyst), `src/ask` (text to SQL), `src/llm` (OpenRouter), CSV export for BI tools |
| Automated workflows that reduce manual reporting | `scripts/run-reports.ts` + `.github/workflows/weekly-digest.yml` |
| Spot manual, repetitive data processes and design solutions | `src/triage` + saved reports in `src/reports` |
| Integrations across multiple systems | `src/reconcile` (ERP vs billing export), `src/notify` (Slack) |
| Faster reporting, less IT bottleneck, measurable | `src/metrics` + the Impact page, with its assumptions shown |
| Evaluate and recommend AI tools | [`docs/ai-tool-evaluation.md`](docs/ai-tool-evaluation.md) |
| Groundwork for agentic workflows | The assistant itself, plus [`docs/agentic-roadmap.md`](docs/agentic-roadmap.md) |
| SQL, ERP-shaped data, BI tools | Order-to-cash and procure-to-pay schema (`src/db/schema.ts`); every report downloads as CSV |
| Work with IT and stakeholders | [`docs/runbook.md`](docs/runbook.md), escalation reasons, audit log |

## Run it

Needs Node 22.13 or newer (uses the built-in `node:sqlite`, so there is no native build step).

```bash
npm install
npm run seed     # synthetic ERP + demo request log
npm run dev      # http://127.0.0.1:8787
npm test
```

No API key is needed to try most of it: saved reports, triage, reconciliation and five example questions all work. The assistant and free-form questions need an OpenRouter key: copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`.

## Security model

The risky part of this project is letting a language model near a database. Model output is treated as untrusted input, and several independent layers sit between it and the data:

| Layer | What it does | Where |
|---|---|---|
| Fixed tool list | The assistant can only call five named tools. None writes or sends. Unknown tools and bad arguments are rejected, and every call still gets a result back | `src/assistant` |
| Bounded loop | At most 6 tool rounds and 4 calls per round, then the model is told to answer with what it has | `src/assistant` |
| Human in the loop | Emails are drafts only, labelled "Draft, not sent" | `src/assistant`, UI |
| SQL guard | One statement only; `SELECT`/CTE only; forbidden keywords; table allowlist; no quoted identifiers, schema-qualified names, table functions, comma joins or `RECURSIVE`; row limit forced. Applies to both Ask and the assistant | `src/sql-guard` |
| Read-only connection | SQLite opens the ERP read-only, so even a guard bug cannot write | `src/db/sqlite.ts` |
| Untrusted input | User questions and tool results are data, not instructions. Client-supplied `system` or `tool` messages are rejected, so the conversation history cannot be forged | `src/assistant`, `src/api` |
| Minimal exposure | The model is only shown the approved tables; billing and app tables are not in its prompt or allowlist | `src/db/schema.ts` |
| Separated state | The request log and audit trail live in a different database from the ERP | `src/store` |
| Audit trail | Every generated query and its outcome is recorded, including why an AI call failed | `audit_log` |
| Abuse limits | Per-client rate limits (tighter for the assistant, since one message can trigger several model calls), body size caps, message length caps | `src/api` |
| No leakage | Errors from the database, provider or server never reach the client; the config loader never echoes values | `src/api/handler.ts`, `src/config` |
| Output safety | UI renders model text as DOM nodes, never HTML; CSV export neutralises spreadsheet formulas; CSP forbids inline script | `public/js`, `src/reports` |
| Secrets | `.env` is gitignored; only `.env.example` (names, no values) is committed; CI scans history with gitleaks | `.gitignore`, `.github/workflows/ci.yml` |

## Architecture

Small modules that depend on interfaces, not each other's internals:

```
src/
  config/      validated env config (zod)
  db/          Database interface; SQLite and D1 adapters; schema; seed
  llm/         LlmClient / ToolLlmClient interfaces; OpenRouter client
  sql-guard/   validates generated SQL
  assistant/   tool-calling analyst: tools, bounded loop, drafts
  ask/         question -> guarded SQL -> rows (retry, audit)
  reports/     saved reports, CSV, digest
  kpis/        headline numbers
  triage/      route a request: report / ask / IT
  reconcile/   compare two systems
  metrics/     impact figures from the request log
  store/       request log + audit trail
  notify/      Slack digest delivery
  api/         one fetch-style handler, used by both runtimes
  server.ts    Node entry      worker.ts   Cloudflare Workers entry
public/        dependency-free ES-module frontend with hand-built SVG charts
```

`api/handler.ts` takes a standard `Request` and returns a `Response`, so the same code serves the local Node server and a Cloudflare Worker. Only the database adapter and static-file serving differ.

SQLite was chosen over a hosted Postgres for the demo: zero accounts, always on, a fresh clone runs in seconds. The `Database` interface keeps that a replaceable detail; see the runbook for what moving to Postgres involves.

## Testing

`npm test` runs the whole suite (168 tests) with no network and no API key; the LLM is replaced by a fake that scripts tool calls and records what it was sent.

- **Guard**: adversarial cases (writes, multiple statements, comment tricks, hidden tables, CTE shadowing, quoted identifiers, recursion).
- **Assistant**: the tool loop with real data flowing back; destructive SQL never executing; unknown tools, malformed arguments and tool-call floods; the forced-answer fallback; drafts that send nothing; forged roles and oversized input rejected; provider failures logged without leaking.
- **Ask**: retry with feedback, destructive output refused and data verified intact, generic errors, audit entries, row limits.
- **Reports and KPIs**: each report runs and passes the guard; aging buckets and KPIs reconcile against independent calculations.
- **API**: routing, validation, rate limiting, CSV, and that a database failure produces a generic 500.
- **Plumbing**: config, OpenRouter client and tool-call wire format (no key in errors), Slack host allowlist, D1 adapter.

## Limits, stated plainly

- **Demo data.** The Impact page's starting figures come from 28 seeded sample requests chosen to look like a real inbox. They illustrate the mechanism; they are not evidence of a real-world result. The "hours saved" figure rests on a stated assumption (45 minutes per manual request), shown on the page.
- **Generated answers need checking.** The tests prove nothing unsafe executes and that the plumbing behaves. They do not prove the model's answers are right, and the live model has been wrong in instructive ways with `openai/gpt-4o-mini`:
  - It excluded open orders from "revenue" until the prompt gained explicit business definitions.
  - It summed `orders.total` after joining line items, which inflated revenue-by-category about 2.4x. A definition now forbids that, and the corrected answer matches an independent calculation exactly for all five categories.
  - It once pasted an email into the chat instead of using the draft tool, which bypasses the review gate. The prompt now requires the tool.
  - Some answers are plausible but imperfect: a two-part question answered only in part, and one overdue-balance query that can merge two same-amount invoices.

  Each fix was verified against the data, but the lesson is the general one: a real rollout needs a scored question set run on every change (see the roadmap). That is why the steps and SQL are always shown beside the answer.
- **Triage is rule-based.** It is fast, free and explainable, and it will misroute phrasing it has not seen. It is isolated behind one function so an LLM classifier can replace it.
- **Cloudflare deployment is untested.** The Worker, D1 adapter and `wrangler.toml` exist and the handler is covered by tests, but the deploy has not been run end to end. Steps are in the runbook.
- **Rate limiting is per process.** On Workers it is per isolate, so it is a brake, not a guarantee.
- **The ERP is a mock.** It is shaped like an ERP's order-to-cash and procure-to-pay core, but it is not a specific vendor's schema.
