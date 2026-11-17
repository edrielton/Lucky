import { randomUUID } from "node:crypto";
import type { ChatMessage, ModelProvider, ModelReply, Tool, ToolCall } from "../types.ts";

const toolsSpec = (tools: Tool[]) =>
  tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Modelo respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Ollama local (http://localhost:11434). */
export class OllamaProvider implements ModelProvider {
  name: string;
  private base: string;
  private model: string;
  constructor(base: string, model: string) {
    this.base = base.replace(/\/$/, "");
    this.model = model;
    this.name = `ollama:${model}`;
  }
  async chat(messages: ChatMessage[], tools: Tool[]): Promise<ModelReply> {
    const msgs = messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.toolName ? { tool_name: m.toolName } : {}),
      ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } })) } : {}),
    }));
    const data = await post(`${this.base}/api/chat`, { model: this.model, messages: msgs, tools: toolsSpec(tools), stream: false });
    const calls: ToolCall[] = (data.message?.tool_calls ?? []).map((c: any) => ({
      id: randomUUID().slice(0, 8), name: c.function.name, args: c.function.arguments ?? {},
    }));
    return { content: data.message?.content ?? "", toolCalls: calls };
  }
}

/** Qualquer servidor compatível com OpenAI (llama.cpp server, LM Studio, vLLM...). */
export class OpenAICompatProvider implements ModelProvider {
  name: string;
  private base: string;
  private model: string;
  private key?: string;
  constructor(base: string, model: string, key?: string) {
    this.base = base.replace(/\/$/, "");
    this.model = model;
    this.key = key;
    this.name = `openai-compat:${model}`;
  }
  async chat(messages: ChatMessage[], tools: Tool[]): Promise<ModelReply> {
    const msgs = messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      ...(m.toolCalls?.length
        ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
        : {}),
    }));
    const data = await post(
      `${this.base}/chat/completions`,
      { model: this.model, messages: msgs, tools: toolsSpec(tools) },
      this.key ? { Authorization: `Bearer ${this.key}` } : {},
    );
    const msg = data.choices?.[0]?.message ?? {};
    const calls: ToolCall[] = (msg.tool_calls ?? []).map((c: any) => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(c.function.arguments || "{}"); } catch { /* argumentos inválidos → vazio */ }
      return { id: c.id ?? randomUUID().slice(0, 8), name: c.function.name, args };
    });
    return { content: msg.content ?? "", toolCalls: calls };
  }
}

/** Modo degradado: sem modelo, o Lucky continua gerindo estado e missões, sem fingir inteligência. */
export class NullProvider implements ModelProvider {
  name = "nenhum (modo limitado)";
  async chat(): Promise<ModelReply> {
    throw new Error("Nenhum modelo configurado (defina LUCKY_PROVIDER=ollama ou openai)");
  }
}
