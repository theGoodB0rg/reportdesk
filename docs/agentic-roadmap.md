# Agentic workflows: what exists and what comes next

The immediate priority for this kind of work is reporting efficiency, with more autonomous workflows later. This project already includes a first, deliberately constrained agent: the **Assistant** (`src/assistant`). This note records what it does, what it is not allowed to do, and the order in which that should change.

## What exists now

- **A tool-calling analyst.** The model chooses among five named tools (`get_kpis`, `run_saved_report`, `run_sql`, `check_reconciliation`, `draft_email`), reads the results, and writes the answer. It may chain several calls before answering.
- **Read-only by construction.** No tool writes to the ERP or sends anything. SQL it writes goes through the same guard and the same read-only connection as the Ask page.
- **A human gate on side effects.** The only "action" is `draft_email`, which produces a draft labelled "Draft, not sent". A person reviews and sends.
- **A bounded loop.** At most 6 rounds of tool use and 4 calls per round, then the model is told to answer with what it has. Tool results are truncated before they reach the model.
- **Transparency.** Every step is shown beside the answer, with the SQL for any query the model wrote, and every query is written to an audit log (including the cause of any AI failure).
- **Interfaces at every boundary.** `ToolLlmClient` and `Database` are interfaces, so a different provider or database slots in. Tests drive the whole loop with a fake model that scripts tool calls.

## What testing it live showed

The live model made real mistakes, which is the reason the next steps below are ordered the way they are:

- It excluded open orders from "revenue" until the prompt included explicit business definitions.
- It summed `orders.total` after joining line items (a fan-out error that inflated revenue-by-category about 2.4x) until a definition forbade it.
- It pasted an email into chat instead of calling the draft tool, which would have bypassed the review gate, until the prompt required the tool.

All three were fixed and verified against independent calculations. None would have been caught by tests that use a fake model, which is why evaluation against the real model is step 1.

## Next steps, in order

1. **Evaluation set.** A fixed list of questions with known-correct answers, run against the real model and scored on every prompt, tool or model change. This is the most valuable missing piece, and it should come before more autonomy.
2. **More named tools** such as `explain_variance` and `forecast_cash`, each with typed inputs and tests, so the model picks among vetted actions rather than writing free-form SQL for everything. Fewer free-form queries means fewer chances for the errors above.
3. **Approval-gated actions.** Let a person approve a draft with one click to send it (Slack or email), with the approver recorded. Autonomy should be earned per action, not granted globally.
4. **Scoped credentials per tool**, so a tool that reads one schema holds a credential that can only read that schema.
5. **Cost and loop controls** per request: token budgets, a kill switch, and spend alerts.

## Deliberately not built

- Any write access to the ERP.
- Sending anything without a person's approval.
- Unbounded autonomous loops.
- Long-term memory of past conversations.

Each adds risk that is not justified until the read-only path has a measured track record.
