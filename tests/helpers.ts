import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { APP_DDL, ERP_DDL } from "../src/db/schema.js";
import { AS_OF, seedErp } from "../src/db/seed.js";
import { SqliteDatabase } from "../src/db/sqlite.js";
import type { AgentMessage, AgentReply, ChatMessage, Llm, ToolSpec } from "../src/llm/index.js";
import { AppStore } from "../src/store/index.js";

/** A seeded ERP opened read-only (as in production) plus a fresh in-memory app store. */
export function createTestEnv() {
  const dir = mkdtempSync(join(tmpdir(), "reportdesk-test-"));
  const path = join(dir, "erp.db");
  const writer = SqliteDatabase.open(path);
  writer.exec(ERP_DDL);
  seedErp(writer.raw);
  writer.close();

  const erp = SqliteDatabase.open(path, { readOnly: true });
  const appDb = SqliteDatabase.open(":memory:");
  appDb.exec(APP_DDL);
  const store = new AppStore(appDb);

  afterAll(() => {
    erp.close();
    appDb.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can briefly hold the file; the OS temp dir is cleaned up eventually.
    }
  });

  return { erp, store, asOf: AS_OF };
}

/**
 * Replays canned replies in order and records every conversation it was given.
 * `replies` serve plain completions; `toolReplies` serve tool-calling turns.
 */
export class FakeLlm implements Llm {
  calls: ChatMessage[][] = [];
  toolCalls: { messages: AgentMessage[]; tools: ToolSpec[] }[] = [];

  constructor(
    private replies: (string | Error)[] = [],
    private toolReplies: (AgentReply | Error)[] = [],
  ) {}

  async complete(messages: ChatMessage[]): Promise<string> {
    this.calls.push(structuredClone(messages));
    const next = this.replies.shift();
    if (next === undefined) throw new Error("FakeLlm has no more replies");
    if (next instanceof Error) throw next;
    return next;
  }

  async chatWithTools(messages: AgentMessage[], tools: ToolSpec[]): Promise<AgentReply> {
    this.toolCalls.push({ messages: structuredClone(messages), tools });
    const next = this.toolReplies.shift();
    if (next === undefined) throw new Error("FakeLlm has no more tool replies");
    if (next instanceof Error) throw next;
    return next;
  }
}

/** A model turn that calls tools. */
export const calls = (...specs: [name: string, args: unknown][]): AgentReply => ({
  content: null,
  toolCalls: specs.map(([name, args], i) => ({ id: `call_${i}`, name, arguments: JSON.stringify(args) })),
});
/** A model turn that answers in text. */
export const says = (content: string): AgentReply => ({ content, toolCalls: [] });

export const sqlBlock = (sql: string) => "```sql\n" + sql + "\n```";
