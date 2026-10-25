import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/index.js";

describe("loadConfig", () => {
  it("applies defaults when nothing is set", () => {
    const c = loadConfig({});
    expect(c.openRouterApiKey).toBeUndefined();
    expect(c.queryRowLimit).toBe(500);
    expect(c.erpDbPath).toBe("./data/erp.db");
    expect(c.port).toBe(8787);
  });

  it("treats blank values (KEY=) as unset", () => {
    const c = loadConfig({ OPENROUTER_API_KEY: "", QUERY_ROW_LIMIT: "", SLACK_WEBHOOK_URL: "" });
    expect(c.openRouterApiKey).toBeUndefined();
    expect(c.queryRowLimit).toBe(500);
  });

  it("reads provided values", () => {
    const c = loadConfig({ OPENROUTER_API_KEY: "k", QUERY_ROW_LIMIT: "50", AS_OF: "2026-01-31" });
    expect(c.openRouterApiKey).toBe("k");
    expect(c.queryRowLimit).toBe(50);
    expect(c.asOf).toBe("2026-01-31");
  });

  it("reads public-demo settings with safe defaults", () => {
    expect(loadConfig({})).toMatchObject({ publicDemo: false, aiDailyBudget: 400, aiClientDailyBudget: 40 });
    expect(loadConfig({ PUBLIC_DEMO: "true", AI_DAILY_BUDGET: "150", AI_CLIENT_DAILY_BUDGET: "12" })).toMatchObject({
      publicDemo: true,
      aiDailyBudget: 150,
      aiClientDailyBudget: 12,
    });
    expect(() => loadConfig({ PUBLIC_DEMO: "yes" })).toThrow(/PUBLIC_DEMO/);
    expect(() => loadConfig({ AI_DAILY_BUDGET: "0" })).toThrow(/AI_DAILY_BUDGET/);
  });

  it("rejects invalid values and names the variable", () => {
    expect(() => loadConfig({ QUERY_ROW_LIMIT: "0" })).toThrow(/QUERY_ROW_LIMIT/);
    expect(() => loadConfig({ AS_OF: "yesterday" })).toThrow(/AS_OF/);
  });

  it("never echoes a bad value back in the error", () => {
    const secretish = "hunter2-not-a-number";
    try {
      loadConfig({ OPENROUTER_API_KEY: "sk-live-secret", QUERY_ROW_LIMIT: secretish });
      throw new Error("expected loadConfig to throw");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain(secretish);
      expect(message).not.toContain("sk-live-secret");
    }
  });
});
