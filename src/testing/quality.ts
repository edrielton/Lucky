import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { runSelfTests, type TestRunResult } from "./runner.ts";

export type CheckStatus = "PASSOU" | "FALHOU" | "AVISO" | "PULADO";
export interface QualityCheck {
  name: string;
  status: CheckStatus;
  durationMs: number;
  detail: string;
}
export interface QualityGateResult {
  ok: boolean;
  checks: QualityCheck[];
  selfTests?: TestRunResult;
  report: string;
}

const MIN_NODE = { major: 22, minor: 18, patch: 0 };
const MAX_OUTPUT_BYTES = 500_000;
const SECRET_ENV = /(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY|ACCESS_KEY)/i;

export function isSupportedNodeVersion(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (!match) return false;
  const actual = match.slice(1, 4).map(Number);
  if (actual[0] !== MIN_NODE.major) return actual[0] > MIN_NODE.major;
  if (actual[1] !== MIN_NODE.minor) return actual[1] > MIN_NODE.minor;
  return actual[2] >= MIN_NODE.patch;
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SECRET_ENV.test(key) && key !== "NODE_OPTIONS") env[key] = value;
  }
  env.CI = "1";
  return env;
}

function findTsc(root: string): { command: string; args: string[] } | null {
  const local = path.join(root, "node_modules", "typescript", "bin", "tsc");
  if (fs.existsSync(local)) return { command: process.execPath, args: [local, "--noEmit"] };
  const names = process.platform === "win32" ? ["tsc.cmd", "tsc.exe", "tsc"] : ["tsc"];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (!fs.existsSync(candidate)) continue;
      if (candidate.toLowerCase().endsWith(".cmd")) {
        return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"\\"${candidate}\\" --noEmit"`] };
      }
      return { command: candidate, args: ["--noEmit"] };
    }
  }
  return null;
}

async function runCommand(command: string, args: string[], cwd: string, timeoutMs = 90_000): Promise<{ code: number | null; output: string; timedOut: boolean; durationMs: number }> {
  const start = performance.now();
  return await new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(command, args, { cwd, env: cleanEnv(), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const append = (chunk: Buffer | string) => {
      const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(output);
      if (remaining <= 0) return;
      output += Buffer.from(chunk).toString("utf8").slice(0, remaining);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 1500);
      force.unref();
    }, timeoutMs);
    timer.unref();
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: 1, output: `${output}\nFalha ao iniciar verificação: ${error.message}`, timedOut, durationMs: Math.round(performance.now() - start) });
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, output, timedOut, durationMs: Math.round(performance.now() - start) });
    });
  });
}

function add(checks: QualityCheck[], name: string, status: CheckStatus, detail: string, durationMs = 0): void {
  checks.push({ name, status, detail, durationMs });
}

export async function runQualityGate(projectRoot: string): Promise<QualityGateResult> {
  const root = fs.realpathSync(path.resolve(projectRoot));
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) throw new Error(`package.json não encontrado em ${root}`);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string };
  if (pkg.name !== "lucky") throw new Error("Portão de qualidade recusado: a raiz não parece ser o projeto Lucky.");

  const checks: QualityCheck[] = [];
  const nodeSupported = isSupportedNodeVersion(process.version);
  add(checks, "Versão do Node.js", nodeSupported ? "PASSOU" : "FALHOU", nodeSupported
    ? `${process.version} atende ao mínimo 22.18.0.`
    : `${process.version} está abaixo do mínimo 22.18.0; não é possível certificar a versão-alvo.`);

  const testStart = performance.now();
  let selfTests: TestRunResult | undefined;
  try {
    selfTests = await runSelfTests(root);
    add(checks, "Suíte de regressão", selfTests.ok ? "PASSOU" : "FALHOU", selfTests.report, Math.round(performance.now() - testStart));
  } catch (error) {
    add(checks, "Suíte de regressão", "FALHOU", (error as Error).message, Math.round(performance.now() - testStart));
  }

  const tsc = findTsc(root);
  if (!tsc) {
    add(checks, "TypeScript", "FALHOU", "Compilador TypeScript não encontrado. Instale as dependências antes de aprovar uma versão.");
  } else {
    const r = await runCommand(tsc.command, tsc.args, root);
    add(checks, "TypeScript", r.code === 0 && !r.timedOut ? "PASSOU" : "FALHOU", r.timedOut ? "Verificação de tipos excedeu o limite de tempo." : (r.output.trim() || `Código de saída: ${r.code}`), r.durationMs);
  }

  const popup = path.join(root, "pc-extension", "popup.js");
  if (fs.existsSync(popup)) {
    const r = await runCommand(process.execPath, ["--check", popup], root, 15_000);
    add(checks, "Sintaxe da extensão PC", r.code === 0 && !r.timedOut ? "PASSOU" : "FALHOU", r.output.trim() || `Código de saída: ${r.code}`, r.durationMs);
  } else {
    add(checks, "Sintaxe da extensão PC", "PULADO", "pc-extension/popup.js não encontrado.");
  }

  const manifestPath = path.join(root, "pc-extension", "manifest.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { manifest_version?: number; name?: string; version?: string };
    const valid = manifest.manifest_version === 3 && typeof manifest.name === "string" && typeof manifest.version === "string";
    add(checks, "Manifesto da extensão", valid ? "PASSOU" : "FALHOU", valid ? "JSON válido e campos básicos do Manifest V3 presentes." : "Manifesto JSON válido, mas faltam campos básicos ou manifest_version não é 3.");
  } catch (error) {
    add(checks, "Manifesto da extensão", "FALHOU", `Manifesto inválido ou ausente: ${(error as Error).message}`);
  }

  const ok = checks.every((c) => c.status === "PASSOU" || c.status === "PULADO");
  const report = [
    `PORTÃO DE QUALIDADE: ${ok ? "APROVADO" : "REPROVADO"}`,
    ...checks.map((c) => `\n[${c.status}] ${c.name}${c.durationMs ? ` (${(c.durationMs / 1000).toFixed(2)} s)` : ""}\n${c.detail}`),
    "\nEste relatório valida somente as verificações executadas. Não prova ausência absoluta de defeitos nem substitui testes em dispositivos e ambientes reais.",
  ].join("\n");
  return { ok, checks, selfTests, report };
}
