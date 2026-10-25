import { describe, expect, it } from "vitest";
import { postToSlack } from "../src/notify/index.js";

const ok = (async () => new Response("ok")) as unknown as typeof fetch;

describe("postToSlack", () => {
  it("rejects any host other than Slack's webhook host", async () => {
    await expect(postToSlack("https://evil.example/hook", "x", ok)).rejects.toThrow(/hooks\.slack\.com/);
    await expect(postToSlack("http://hooks.slack.com/services/a", "x", ok)).rejects.toThrow(/https/);
    await expect(postToSlack("https://hooks.slack.com.evil.example/x", "x", ok)).rejects.toThrow();
    await expect(postToSlack("not a url", "x", ok)).rejects.toThrow(/valid URL/);
  });

  it("posts JSON text and truncates very long digests", async () => {
    let body = "";
    const capture = (async (_u: unknown, init: RequestInit) => {
      body = init.body as string;
      return new Response("ok");
    }) as unknown as typeof fetch;
    await postToSlack("https://hooks.slack.com/services/T/B/x", "a".repeat(5000), capture);
    const { text } = JSON.parse(body);
    expect(text.length).toBeLessThanOrEqual(3000);
    expect(text).toMatch(/truncated/);
  });

  it("throws when Slack returns an error, without echoing the webhook URL", async () => {
    const bad = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    const err = await postToSlack("https://hooks.slack.com/services/T/B/secret", "x", bad).catch((e) => e);
    expect(err.message).toContain("404");
    expect(err.message).not.toContain("secret");
  });
});
