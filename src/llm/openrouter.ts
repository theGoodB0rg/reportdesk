import { LlmError, type AgentMessage, type AgentReply, type ChatMessage, type Llm, type ToolSpec } from "./index.js";

export type OpenRouterOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type ApiMessage = {
  content?: unknown;
  tool_calls?: { id?: unknown; function?: { name?: unknown; arguments?: unknown } }[];
};

export class OpenRouterClient implements Llm {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OpenRouterOptions) {
    this.baseUrl = opts.baseUrl ?? "https://openrouter.ai/api/v1";
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** One authenticated request. Errors never carry the key or the underlying network error. */
  private async post(body: Record<string, unknown>): Promise<ApiMessage> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.opts.model, ...body }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new LlmError("OpenRouter request failed or timed out");
    }
    if (!res.ok) throw new LlmError(`OpenRouter returned HTTP ${res.status}`);

    const json = (await res.json().catch(() => null)) as { choices?: { message?: ApiMessage }[] } | null;
    const message = json?.choices?.[0]?.message;
    if (!message) throw new LlmError("OpenRouter returned no message");
    return message;
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    const message = await this.post({ messages, temperature: 0, max_tokens: 600 });
    if (typeof message.content !== "string" || !message.content.trim()) throw new LlmError("OpenRouter returned no content");
    return message.content;
  }

  async chatWithTools(messages: AgentMessage[], tools: ToolSpec[]): Promise<AgentReply> {
    const wire = messages.map((m) => {
      if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "assistant",
          content: m.content,
          tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
        };
      }
      return { role: m.role, content: m.content };
    });

    const message = await this.post({
      messages: wire,
      temperature: 0.2,
      max_tokens: 1200,
      ...(tools.length
        ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) }
        : {}),
    });

    const toolCalls = (message.tool_calls ?? []).flatMap((c) =>
      typeof c.id === "string" && typeof c.function?.name === "string"
        ? [{ id: c.id, name: c.function.name, arguments: typeof c.function.arguments === "string" ? c.function.arguments : "{}" }]
        : [],
    );
    return { content: typeof message.content === "string" ? message.content : null, toolCalls };
  }
}
