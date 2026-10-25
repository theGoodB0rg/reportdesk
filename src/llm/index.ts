export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Everything the app needs from a language model. Tests supply a fake. */
export interface LlmClient {
  complete(messages: ChatMessage[]): Promise<string>;
}

/* Tool calling ---------------------------------------------------------- */

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolCall = { id: string; name: string; arguments: string };

export type AgentMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type AgentReply = { content: string | null; toolCalls: ToolCall[] };

/** A model that can call tools. Omit `tools` (pass []) to force a plain-text answer. */
export interface ToolLlmClient {
  chatWithTools(messages: AgentMessage[], tools: ToolSpec[]): Promise<AgentReply>;
}

export type Llm = LlmClient & ToolLlmClient;

export class LlmError extends Error {}
