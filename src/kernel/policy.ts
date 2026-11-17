import fs from "node:fs";
import path from "node:path";
import type { Decision, Mode, Tool } from "../types.ts";

const SHELL_META = /[;&|<>`$\n\r]/;
const DENY_CMD = [
  /\brm\b/i, /\bdel\b/i, /\brmdir\b/i, /\bformat\b/i, /\bshutdown\b/i, /\breg\b/i,
  /\bchmod\b/i, /\bchown\b/i, /\bsudo\b/i, /\bpowershell\b/i, /\bcmd(\.exe)?\b/i,
  /\bcurl\b/i, /\bwget\b/i, /\bssh\b/i,
];
const SAFE_CMD = [/^git (status|diff|log)$/, /^node --version$/];

/** Resolve um caminho garantindo que ele fica dentro do workspace (inclusive via symlink). */
export function resolveInside(workspace: string, p: string): string {
  const root = fs.realpathSync(workspace);
  const target = path.resolve(root, p);
  let probe = target;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const real = path.join(fs.realpathSync(probe), path.relative(probe, target));
  const rel = path.relative(root, real);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Caminho fora do workspace: ${p}`);
  return real;
}

export function decideCommand(cmd: string): Decision {
  const c = cmd.trim();
  if (!c) return { action: "deny", reason: "Comando vazio" };
  if (c.includes("\0")) return { action: "deny", reason: "Caractere NUL não permitido" };
  if (SHELL_META.test(c)) return { action: "deny", reason: "Metacaracteres de shell não são permitidos" };
  if (DENY_CMD.some((r) => r.test(c))) return { action: "deny", reason: "Comando na lista de bloqueio" };
  if (SAFE_CMD.some((r) => r.test(c))) return { action: "allow" };
  return { action: "ask", reason: "Comando fora da lista segura" };
}

/** Decisão determinística: não depende do que o modelo "prometeu". */
export function decide(tool: Tool, args: Record<string, unknown>, mode: Mode, workspace: string): Decision {
  try {
    if (tool.name === "read_file" || tool.name === "write_file") resolveInside(workspace, String(args.path ?? ""));
    if (tool.name === "list_dir") resolveInside(workspace, String(args.path ?? "."));
  } catch (e) {
    return { action: "deny", reason: (e as Error).message };
  }
  if (tool.name === "run_command") {
    const c = decideCommand(String(args.command ?? ""));
    if (c.action !== "ask") return c;
  } else if (tool.risk === "read") {
    return { action: "allow" };
  }
  if (mode === "plan") return { action: "deny", reason: "Modo plan: somente leitura" };
  if (tool.risk === "write_reversible" && mode === "auto") return { action: "allow" };
  return { action: "ask", reason: `${tool.name} (${tool.risk})` };
}
