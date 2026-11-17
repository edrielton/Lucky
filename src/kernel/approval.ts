import { createHash } from "node:crypto";

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)]));
  }
  return v;
}

export function actionHash(tool: string, args: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify([tool, canonical(args)])).digest("hex");
}

export type Prompter = (summary: string, hash: string) => Promise<boolean>;

/** A aprovação vale para UMA ação exata (hash) e só uma vez. Mudou o conteúdo → pede de novo. */
export class ApprovalGate {
  private granted = new Set<string>();
  private prompt: Prompter;
  constructor(prompt: Prompter) {
    this.prompt = prompt;
  }
  async request(tool: string, args: Record<string, unknown>, summary: string): Promise<boolean> {
    const h = actionHash(tool, args);
    const ok = await this.prompt(summary, h);
    if (ok) this.granted.add(h);
    return ok;
  }
  consume(tool: string, args: Record<string, unknown>): boolean {
    return this.granted.delete(actionHash(tool, args));
  }
}
