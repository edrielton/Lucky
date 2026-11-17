import { execFile } from "node:child_process";
import { decideCommand } from "./kernel/policy.ts";

/**
 * Executa um único programa sem shell. Comandos fora da allowlist exigem uma
 * aprovação explícita do fluxo do agente; comandos bloqueados nunca executam.
 * A aprovação não permite metacaracteres de shell nem transforma o comando em
 * uma string de shell: os argumentos continuam separados e passados ao execFile.
 */
export function runCommand(
  command: string,
  cwd: string,
  timeoutMs = 60_000,
  approved = false,
): Promise<{ code: number; output: string }> {
  const trimmed = command.trim();
  const decision = decideCommand(trimmed);
  if (decision.action === "deny") {
    return Promise.resolve({ code: 126, output: `Comando bloqueado: ${decision.reason}` });
  }
  if (decision.action === "ask" && !approved) {
    return Promise.resolve({ code: 126, output: `Comando exige aprovação explícita: ${decision.reason}` });
  }
  if (!trimmed) return Promise.resolve({ code: 126, output: "Comando vazio" });

  // Sem shell, metacaracteres nunca são interpretados como operadores. Este
  // parser intencionalmente não implementa quoting de shell; evita ambiguidades.
  const [file, ...args] = trimmed.split(/\s+/);
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 1_000_000, shell: false, windowsHide: true },
      (err, stdout, stderr) => {
        const raw = (err as { code?: unknown } | null)?.code;
        const code = err ? (typeof raw === "number" ? raw : 1) : 0;
        const output = `${stdout}${stderr}`.slice(0, 20_000);
        resolve({ code, output });
      },
    );
  });
}
