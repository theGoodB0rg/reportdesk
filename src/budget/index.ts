import type { Database } from "../db/types.js";
import { LlmError, type AgentMessage, type AgentReply, type ChatMessage, type Llm, type ToolSpec } from "../llm/index.js";

/**
 * A hard daily cap on model calls, so a public demo can never spend more than a
 * known amount, whoever visits and however they behave. Counters live in the
 * database (not in memory), so the cap holds across every Worker instance.
 */

export type BudgetScope = "global" | "client";
export type BudgetLimits = { global: number; client: number };

export class BudgetExceededError extends LlmError {
  constructor(readonly scope: BudgetScope) {
    super(`AI budget exhausted (${scope})`);
  }
}

/** What a visitor is told. Reports and the cached examples keep working. */
export function budgetMessage(err: BudgetExceededError): string {
  return err.scope === "client"
    ? "You've reached today's AI limit for this public demo. Reports and the example questions still work, and the project runs locally without a cap."
    : "This public demo's AI budget for today is used up. Reports and the example questions still work, and it resets at midnight UTC.";
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** One-way, per-day identifier: counts a visitor without storing their address. */
async function clientId(client: string, day: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`reportdesk|${day}|${client}`));
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class UsageBudget {
  constructor(
    private readonly db: Database,
    private readonly limits: BudgetLimits,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Atomic increment-and-read, so concurrent requests cannot slip past the limit together. */
  private async bump(key: string): Promise<number> {
    const rows = await this.db.query<{ count: number }>(
      "INSERT INTO usage (key, count) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count",
      [key],
    );
    return Number(rows[0]?.count ?? Number.POSITIVE_INFINITY);
  }

  /**
   * Spends one model call, or throws. The visitor's own allowance is checked
   * first so one heavy user cannot burn the shared budget. Any database error
   * propagates, which makes the budget fail closed.
   */
  async consume(client: string): Promise<void> {
    const day = dayOf(this.now());
    if ((await this.bump(`c:${await clientId(client, day)}:${day}`)) > this.limits.client) throw new BudgetExceededError("client");
    if ((await this.bump(`g:${day}`)) > this.limits.global) throw new BudgetExceededError("global");
  }
}

/** Wraps a model so that every call, plain or tool-using, spends from the budget first. */
export class BudgetedLlm implements Llm {
  constructor(
    private readonly inner: Llm,
    private readonly budget: UsageBudget,
    private readonly client: string,
  ) {}

  async complete(messages: ChatMessage[]): Promise<string> {
    await this.budget.consume(this.client);
    return this.inner.complete(messages);
  }

  async chatWithTools(messages: AgentMessage[], tools: ToolSpec[]): Promise<AgentReply> {
    await this.budget.consume(this.client);
    return this.inner.chatWithTools(messages, tools);
  }
}
