import { describe, expect, it } from "vitest";
import { LlmError } from "../src/llm/index.js";
import { OpenRouterClient } from "../src/llm/openrouter.js";

const KEY = "sk-or-test-key-123";
const client = (fetchImpl: typeof fetch) => new OpenRouterClient({ apiKey: KEY, model: "test/model", fetchImpl });
const reply = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("OpenRouterClient", () => {
  it("sends an authenticated chat completion request and returns the content", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }));
    }) as unknown as typeof fetch;

    const out = await client(fetchImpl).complete([{ role: "user", content: "hi" }]);

    expect(out).toBe("hello");
    expect(captured!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(captured!.init.body as string);
    expect(body).toMatchObject({ model: "test/model", temperature: 0, messages: [{ role: "user", content: "hi" }] });
  });

  it("sends tools and tool results in the OpenAI wire format, and parses tool calls back", async () => {
    let sent: Record<string, any> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_kpis", arguments: "{}" } }, { bogus: true }] } }],
        }),
      );
    }) as unknown as typeof fetch;

    const reply = await client(fetchImpl).chatWithTools(
      [
        { role: "user", content: "hi" },
        { role: "assistant", content: null, toolCalls: [{ id: "p1", name: "get_kpis", arguments: "{}" }] },
        { role: "tool", toolCallId: "p1", content: "{\"ok\":true}" },
      ],
      [{ name: "get_kpis", description: "KPIs", parameters: { type: "object", properties: {} } }],
    );

    expect(reply).toEqual({ content: null, toolCalls: [{ id: "c1", name: "get_kpis", arguments: "{}" }] }); // malformed call dropped
    expect(sent.tools).toEqual([{ type: "function", function: { name: "get_kpis", description: "KPIs", parameters: { type: "object", properties: {} } } }]);
    expect(sent.messages[1]).toEqual({ role: "assistant", content: null, tool_calls: [{ id: "p1", type: "function", function: { name: "get_kpis", arguments: "{}" } }] });
    expect(sent.messages[2]).toEqual({ role: "tool", tool_call_id: "p1", content: "{\"ok\":true}" });
  });

  it("omits the tools field entirely when asked to answer in plain text", async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: "final" } }] }));
    }) as unknown as typeof fetch;
    const reply = await client(fetchImpl).chatWithTools([{ role: "user", content: "hi" }], []);
    expect(reply).toEqual({ content: "final", toolCalls: [] });
    expect("tools" in sent).toBe(false);
  });

  it("calls the global fetch detached from the client, as Cloudflare's runtime requires", async () => {
    const original = globalThis.fetch;
    let receiver: unknown = "unset";
    globalThis.fetch = function (this: unknown) {
      receiver = this;
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] })));
    } as unknown as typeof fetch;
    try {
      const real = new OpenRouterClient({ apiKey: KEY, model: "test/model" }); // no fetchImpl: uses the global
      await real.complete([{ role: "user", content: "hi" }]);
      expect(receiver).not.toBe(real); // `this` must not be the client (Workers throws "Illegal invocation")
    } finally {
      globalThis.fetch = original;
    }
  });

  it("raises LlmError on HTTP errors without leaking the key", async () => {
    const err = await client(reply({ error: "nope" }, 401)).complete([]).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.message).toContain("401");
    expect(err.message).not.toContain(KEY);
  });

  it("raises LlmError when the network fails", async () => {
    const failing = (async () => {
      throw new Error(`connect failed for key ${KEY}`);
    }) as unknown as typeof fetch;
    const err = await client(failing).complete([]).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.message).not.toContain(KEY);
  });

  it("raises LlmError on empty or malformed responses", async () => {
    await expect(client(reply({ choices: [] })).complete([])).rejects.toBeInstanceOf(LlmError);
    await expect(client(reply({ choices: [{ message: { content: "  " } }] })).complete([])).rejects.toBeInstanceOf(LlmError);
    const notJson = (async () => new Response("<html>")) as unknown as typeof fetch;
    await expect(client(notJson).complete([])).rejects.toBeInstanceOf(LlmError);
  });
});
