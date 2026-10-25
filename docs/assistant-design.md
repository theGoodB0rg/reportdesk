# How the assistant is designed

The Assistant (`src/assistant`) is a tool-calling analyst. The model chooses among a small set of named tools, reads their results, and writes the answer. This note records what it can do, how it is constrained, and why.

## What it does

- **Chooses tools.** `get_kpis`, `run_saved_report`, `run_sql`, `check_reconciliation` and `draft_email`. It may chain several calls before answering.
- **Reads, never writes.** No tool writes to the ERP or sends anything. SQL it writes goes through the same guard and the same read-only access as the Ask page.
- **Hands side effects to a person.** The only action is `draft_email`, which produces a draft labelled "Draft, not sent". A person reviews and sends.
- **Shows its work.** Every step is listed beside the answer, with the SQL for any query the model wrote, and every query is written to an audit log (including the cause of any AI failure).

## How it is constrained

- **Bounded loop.** At most 6 rounds of tool use and 4 calls per round, then the model is told to answer with what it has. Tool results are truncated before they reach the model.
- **Closed tool list.** Unknown tools, malformed JSON and invalid arguments come back as errors the model can recover from, and every call receives a result, so a bad call cannot wedge the conversation.
- **Untrusted text.** User messages and tool results are treated as data. The client cannot supply `system` or `tool` messages, so history cannot be forged.
- **Budgeted.** Every model call spends from a daily per-visitor and global budget (`src/budget`) that is counted in the database and fails closed.
- **Interfaces at every boundary.** `ToolLlmClient` and `Database` are interfaces, so another provider or database slots in, and the tests drive the whole loop with a scripted fake model.

## What testing against the real model showed

Running it against the live model surfaced issues that a fake model cannot, and each led to a specific, verified fix:

- It excluded open orders from "revenue" until the prompt included business definitions.
- It summed `orders.total` after joining line items (a fan-out error that inflated revenue-by-category about 2.4x) until a definition forbade it; the corrected figures match an independent calculation exactly.
- It pasted an email into the chat instead of calling the draft tool, which would have bypassed the review step, until the prompt required the tool.

The definitions are shared by the Ask page and the assistant (`BUSINESS_DEFINITIONS` in `src/db/schema.ts`), so both answer the same way as the saved reports.

## Boundaries by design

The assistant has no write access to the ERP, sends nothing without a person, runs only bounded loops, and keeps no memory between conversations. Giving a model more autonomy is a per-action decision: an action earns it by being reliable, reviewable and audited first, which is how `draft_email` is built. Adding a capability means adding another named, typed, tested tool; the model never gets a database handle or a free-form shell.
