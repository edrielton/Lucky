import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const DEFAULT_SANDBOX_IMAGE = "node:22.18-alpine";

export interface SandboxLimits {
  cpus: number;
  memoryMb: number;
  pids: number;
  timeoutMs: number;
  maxOutputBytes: number;
}

export const DEFAULT_SANDBOX_LIMITS: Readonly<SandboxLimits> = Object.freeze({
  cpus: 1,
  memoryMb: 512,
  pids: 64,
  timeoutMs: 120_000,
  maxOutputBytes: 1_000_000,
});

export interface SandboxCapability {
  available: boolean;
  backend: "docker" | "none";
  image: string;
  reason: string;
}

export function validateSandboxLimits(limits: SandboxLimits): void {
  if (!Number.isFinite(limits.cpus) || limits.cpus < 0.25 || limits.cpus > 4) throw new Error("Limite de CPU inválido (0,25–4 cores).");
  if (!Number.isInteger(limits.memoryMb) || limits.memoryMb < 128 || limits.memoryMb > 4096) throw new Error("Limite de RAM inválido (128–4096 MB).");
  if (!Number.isInteger(limits.pids) || limits.pids < 8 || limits.pids > 256) throw new Error("Limite de processos inválido (8–256).");
  if (!Number.isInteger(limits.timeoutMs) || limits.timeoutMs < 1_000 || limits.timeoutMs > 600_000) throw new Error("Limite de tempo inválido (1.000–600.000 ms).");
  if (!Number.isInteger(limits.maxOutputBytes) || limits.maxOutputBytes < 1024 || limits.maxOutputBytes > 5_000_000) throw new Error("Limite de saída inválido.");
}

/** Resolve caminhos da sandbox e rejeita traversal e links simbólicos em qualquer componente. */
export function resolveSandboxPath(rootPath: string, relativePath: string): string {
  const root = fs.realpathSync(path.resolve(rootPath));
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("A raiz da sandbox precisa ser um diretório real.");
  if (typeof relativePath !== "string" || !relativePath.trim() || path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath)) throw new Error("Caminho da sandbox inválido.");
  if (relativePath === ".") return root;
  const rawParts = relativePath.split(/[\\/]/);
  if (rawParts.some((part) => part === ".." || part === "")) throw new Error("Traversal ou componente vazio bloqueado na sandbox.");
  const target = path.resolve(root, relativePath);
  const rel = path.relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error("Caminho fora da sandbox.");

  let cursor = root;
  for (const part of rel.split(path.sep)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`Link simbólico bloqueado na sandbox: ${relativePath}`);
    if (cursor !== target && !stat.isDirectory()) throw new Error(`Componente intermediário não é diretório: ${relativePath}`);
  }
  return target;
}

/** Só considera a sandbox disponível se Docker e a imagem já existirem localmente. Não faz pull automático. */
export function inspectSandboxCapability(image = DEFAULT_SANDBOX_IMAGE): SandboxCapability {
  const result = spawnSync("docker", ["image", "inspect", image], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    return { available: false, backend: "none", image, reason: `Docker indisponível: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return { available: false, backend: "none", image, reason: `A imagem ${image} não está disponível localmente. O Lucky não fará download automático.` };
  }
  return { available: true, backend: "docker", image, reason: "Docker e imagem local disponíveis; execução isolada pode ser habilitada." };
}

export function requireSandboxCapability(image = DEFAULT_SANDBOX_IMAGE): SandboxCapability {
  const capability = inspectSandboxCapability(image);
  if (!capability.available) {
    throw new Error(`Sandbox de sistema operacional indisponível. ${capability.reason} Instale/inicie Docker e disponibilize a imagem ${image}; o Lucky recusará executar código experimental sem isolamento.`);
  }
  return capability;
}

/** Constrói argumentos sem shell: filesystem do contêiner somente leitura, workspace montado, sem rede e com cotas. */
export function buildDockerSandboxArgs(rootPath: string, commandArgs: string[], limits = DEFAULT_SANDBOX_LIMITS, image = DEFAULT_SANDBOX_IMAGE, runId = randomUUID()): string[] {
  validateSandboxLimits(limits);
  const root = fs.realpathSync(path.resolve(rootPath));
  if (root.includes(",")) throw new Error("O caminho da sandbox não pode conter vírgula ao usar montagem Docker.");
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(runId)) throw new Error("Identificador da execução sandbox inválido.");
  if (!Array.isArray(commandArgs) || commandArgs.length === 0 || commandArgs.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new Error("Comando da sandbox inválido.");
  }
  return [
    "run", "--rm", "--label", `lucky.sandbox.run=${runId}`, "--network", "none", "--read-only",
    "--cpus", String(limits.cpus), "--memory", `${limits.memoryMb}m`, "--memory-swap", `${limits.memoryMb}m`, "--pids-limit", String(limits.pids),
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--user", "1000:1000",
    "--mount", `type=bind,source=${root},target=/workspace,rw`,
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m,mode=1777", "--workdir", "/workspace",
    image, ...commandArgs,
  ];
}
