export type Risk = "read" | "write_reversible" | "irreversible";
/** plan = só leitura · ask = pergunta antes de escrever/executar · auto = escrita reversível liberada */
export type Mode = "plan" | "ask" | "auto";

export interface ToolResult { ok: boolean; output: string }
export interface ToolContext { workspace: string; home: string; approved?: boolean }

/** Contrato de ferramenta: toda integração futura (as ~420) entra por aqui. */
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  risk: Risk;
  permissions: string[]; // o que a ferramenta declara que precisa
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export type Decision =
  | { action: "allow" }
  | { action: "ask"; reason: string }
  | { action: "deny"; reason: string };

export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
}
export interface ModelReply { content: string; toolCalls: ToolCall[] }
/** A inteligência é trocável: local por padrão, remoto só se você quiser. */
export interface ModelProvider {
  name: string;
  chat(messages: ChatMessage[], tools: Tool[]): Promise<ModelReply>;
}
