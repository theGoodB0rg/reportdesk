# AI tool evaluation: how I chose the approach

The brief for this kind of work is usually "connect AI to the ERP, database and reporting tools", with the tool choice left open. This is the reasoning I used for ReportDesk, written the way I would hand it to an IT lead. It is a framework and a decision, not a vendor benchmark. Vendor features and pricing change often, so check current docs before relying on any comparison.

## The problem, restated

Departments ask IT for the same few reports and the occasional one-off number. IT is the bottleneck. The goal is to cut manual reporting load without giving a language model unsupervised access to the system of record.

## Options considered

| Option | What it is | Fits when | Main risk |
|---|---|---|---|
| **Scheduled saved reports** | Plain SQL on a schedule, delivered to Slack/email/BI | Most requests repeat | Does nothing for one-off questions |
| **LLM text-to-SQL behind guardrails** (chosen for ad-hoc) | Model drafts SQL; code validates and executes read-only | Long tail of one-off questions | Wrong or unsafe SQL if unguarded; answers can be confidently wrong |
| **Vendor BI natural-language features** | Q&A built into a BI product | The client already licenses that BI tool and the data is modelled in it | Lock-in; limited control over how queries are checked and logged |
| **Workflow platform (n8n, Make, Zapier)** | Visual glue between systems | Many SaaS-to-SaaS handoffs, non-engineers maintain it | Awkward for tested, versioned logic; per-task costs at scale |
| **Autonomous agent with write access** | Model takes actions in the ERP | Not now | Highest blast radius; no case for it before read-only is trusted |

## Criteria and how they were weighed

1. **Safety on the system of record.** Read-only first. This ruled out agent-with-write-access for now and drove the guardrail design (see the README security table).
2. **Fit with the existing stack.** The brief says SQL database, an ERP, and BI tools, with AI tool-agnostic. So the AI layer sits behind a small `LlmClient` interface and the database behind a `Database` interface; neither choice is welded into the logic.
3. **Auditability.** Every generated query is logged with its outcome, so IT can review what was asked and run.
4. **Cost control.** Cached example questions, a row limit, a per-client rate limit and a cheap default model keep spend bounded. A saved report costs nothing per run.
5. **Time to value.** Saved reports and triage deliver value on day one; text-to-SQL is added on top, not relied on.
6. **Maintainability.** Pure functions and interfaces with tests, so a new engineer can change a report or swap a provider without reading everything.

## What building it showed

Choosing "LLM text-to-SQL behind guardrails" was right for the long tail, but live testing made the trade-off concrete. The guardrails reliably kept anything unsafe from running; they did not stop plausible-but-wrong answers, such as a revenue figure inflated by a join. Explicit business definitions in the prompt fixed the cases found, and the answers were then checked against independent calculations. For a client, that argues for treating generated answers as drafts with their query visible, and for a scored question set before anyone relies on them.

## Decision

- Use **saved reports for the repeating 80%**, and a **guarded text-to-SQL path for the long tail**.
- Keep the **model provider swappable** (OpenRouter here, because one key reaches many models and the choice can be revisited without code changes).
- Keep **BI tools in the loop** via CSV export of every report, so existing dashboards and Excel users are not forced onto a new front end.
- Treat **agentic workflows as phase two**, built on the narrow, logged tool layer that already exists (see `agentic-roadmap.md`).

## What I would ask a real client before building

- Which ERP, which database engine and version, and is there a read replica?
- Which BI tool is licensed today, and are the key reports already modelled there?
- What are the five reports IT is asked for most often? (Start there.)
- Which tables or columns hold data that must never reach a third-party model provider?
- Who reviews the audit log, and what counts as an incident?
- What is the data-processing position on sending schema and questions to an external LLM API?

## Known limits of this evaluation

- Text-to-SQL accuracy was not benchmarked here. The tests prove the safety properties (nothing unsafe executes) and the plumbing (retry, audit, limits), not that the model's answers are correct. A production rollout needs a question set with known answers, scored regularly.
- Cost and latency figures are deliberately absent; they depend on the chosen model and traffic.
