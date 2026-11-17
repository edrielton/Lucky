import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { buildDockerSandboxArgs, DEFAULT_SANDBOX_LIMITS, requireSandboxCapability } from "../security/sandbox.ts";

export interface TestRunResult {
  ok: boolean;
  isolation: "host" | "docker";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  testFiles: string[];
  output: string;
  report: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function stopSandboxContainer(runId: string): void {
  const label = `lucky.sandbox.run=${runId}`;
  const listed = spawnSync("docker", ["ps", "--quiet", "--filter", `label=${label}`], { encoding: "utf8", timeout: 5_000, windowsHide: true });
  const ids = (listed.stdout ?? "").trim().split(/\s+/).filter((id) => /^[a-f0-9]{12,64}$/i.test(id));
  for (const id of ids) spawnSync("docker", ["kill", id], { encoding: "utf8", timeout: 5_000, windowsHide: true, stdio: "ignore" });
}
const MAX_OUTPUT_BYTES = 1_000_000;
const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx|js|mjs|cjs)$/i;
const SENSITIVE_ENV = /(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY|ACCESS_KEY)/i;

function findTestFiles(root: string): string[] {
  const testRoot = path.join(root, "test");
  if (!fs.existsSync(testRoot) || !fs.statSync(testRoot).isDirectory()) return [];

  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      // Never follow symlinks while discovering tests.
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && TEST_FILE.test(entry.name)) found.push(full);
    }
  };
  visit(testRoot);
  return found;
}

function safeTestEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SENSITIVE_ENV.test(key) && key !== "NODE_TEST_CONTEXT") env[key] = value;
  }
  // Keep the child non-interactive; do not pass agent/provider credentials.
  env.CI = "1";
  env.NODE_OPTIONS = "";
  return env;
}

/**
 * Runs the repository's existing Node test files without a shell. This is a
 * test runner, not an OS sandbox: test code still runs with this user's OS
 * permissions. Use it only on the trusted Lucky checkout or a disposable
 * development copy isolated by the host (container/VM/low-privilege account).
 */
export async function runSelfTests(
  projectRoot: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  options: { isolation?: "host" | "docker" } = {},
): Promise<TestRunResult> {
  const root = fs.realpathSync(path.resolve(projectRoot));
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) throw new Error(`package.json não encontrado em ${root}`);
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { name?: unknown; scripts?: Record<string, unknown> };
  if (packageJson.name !== "lucky") throw new Error("Autoteste recusado: a raiz não parece ser o projeto Lucky.");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 10 * 60_000) {
    throw new Error("timeoutMs deve estar entre 1.000 ms e 600.000 ms.");
  }

  const isolation = options.isolation ?? "host";
  if (isolation === "docker") requireSandboxCapability();
  const testFiles = findTestFiles(root);
  if (!testFiles.length) {
    return { ok: false, isolation, exitCode: null, signal: null, timedOut: false, durationMs: 0, testFiles: [], output: "", report: "Nenhum arquivo de teste encontrado em test/." };
  }

  const started = performance.now();
  const command = isolation === "docker" ? "docker" : process.execPath;
  const sandboxRunId = randomUUID();
  const args = isolation === "docker"
    ? buildDockerSandboxArgs(root, ["node", "--experimental-strip-types", "--test", "--no-warnings", ...testFiles.map((file) => `/workspace/${path.relative(root, file).split(path.sep).join("/")}`)], { ...DEFAULT_SANDBOX_LIMITS, timeoutMs }, undefined, sandboxRunId)
    : ["--experimental-strip-types", "--test", "--no-warnings", ...testFiles];
  const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean; output: string }>((resolve) => {
    let output = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(command, args, {
      cwd: root,
      env: safeTestEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = (chunk: Buffer | string) => {
      if (Buffer.byteLength(output) >= MAX_OUTPUT_BYTES) return;
      const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(output);
      output += Buffer.from(chunk).toString("utf8").slice(0, remaining);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      const force = setTimeout(() => {
        child.kill("SIGKILL");
        if (isolation === "docker") stopSandboxContainer(sandboxRunId);
      }, 2_000);
      force.unref();
    }, timeoutMs);
    timer.unref();

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: 1, signal: null, timedOut, output: `${output}\nFalha ao iniciar o executor de testes: ${error.message}` });
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (Buffer.byteLength(output) >= MAX_OUTPUT_BYTES) output += "\n[saída truncada pelo limite de segurança]";
      resolve({ exitCode: code, signal, timedOut, output });
    });
  });

  const durationMs = Math.round(performance.now() - started);
  const testsSummary = result.output.match(/^# tests (\d+)$/m);
  const executedTests = testsSummary ? Number(testsSummary[1]) : 0;
  const ok = result.exitCode === 0 && !result.timedOut && executedTests > 0;
  const report = [
    `Resultado: ${ok ? "APROVADO" : "REPROVADO"}`,
    `Isolamento: ${isolation === "docker" ? "Docker (sem rede, filesystem do contêiner somente leitura, workspace montado e cotas de recursos)" : "processo local; não é sandbox de sistema operacional"}`,
    `Arquivos de teste: ${testFiles.length}`,
    `Testes executados: ${executedTests}`,
    executedTests === 0 ? "Nenhum teste foi confirmado na saída do executor." : "",
    `Duração: ${(durationMs / 1000).toFixed(2)} s`,
    `Código de saída: ${result.exitCode ?? "indisponível"}`,
    result.timedOut ? `Limite de tempo excedido (${timeoutMs} ms).` : "",
    result.signal ? `Sinal de encerramento: ${result.signal}` : "",
  ].filter(Boolean).join("\n");

  return { ...result, ok, isolation, durationMs, testFiles: testFiles.map((f) => path.relative(root, f)), report };
}
