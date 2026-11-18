import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runSelfTests, type TestRunResult } from "../testing/runner.ts";

export interface RepositoryFileChange {
  path: string;
  content: string;
}

export interface RepositoryProposal {
  summary: string;
  rationale: string;
  changes: RepositoryFileChange[];
}

export interface RepositoryInspection {
  root: string;
  baseBranch: string;
  currentBranch: string;
  head: string;
  dirty: boolean;
  topLevel: string[];
  testFiles: string[];
}

export interface RepositoryDevelopmentOptions {
  projectRoot: string;
  baseBranch?: string;
  branchName: string;
  goal: string;
  propose: (context: {
    inspection: RepositoryInspection;
    goal: string;
    baseline: TestRunResult;
  }) => Promise<RepositoryProposal | null>;
  authorizePublish: (context: {
    proposal: RepositoryProposal;
    proposalHash: string;
    diffHash: string;
    diff: string;
    branchName: string;
  }) => Promise<boolean>;
  maxAttempts?: number;
  timeoutMs?: number;
  testRunner?: (root: string, timeoutMs?: number) => Promise<TestRunResult>;
  publishBranch?: (root: string, branchName: string) => Promise<void>;
}

export interface RepositoryDevelopmentResult {
  status: "BASELINE_PASSOU" | "VALIDADO_APROVADO" | "APROVACAO_RECUSADA" | "PROPOSTA_RECUSADA" | "REPROVADO";
  inspection: RepositoryInspection;
  branchName: string;
  proposalHash?: string;
  diffHash?: string;
  diff?: string;
  baseline: TestRunResult;
  finalTests: TestRunResult;
  report: string;
}

const EXCLUDED = new Set([".git", "node_modules"]);
const PROTECTED_PATHS = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "src/development/repository.ts",
  "src/development/cli.ts",
]);

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 2_000_000,
  }).trim();
}

function canonicalProposal(proposal: RepositoryProposal): unknown {
  return {
    summary: proposal.summary,
    rationale: proposal.rationale,
    changes: proposal.changes.map((change) => ({
      path: change.path.replaceAll("\\", "/"),
      content: change.content,
    })).sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export function hashRepositoryProposal(proposal: RepositoryProposal): string {
  return createHash("sha256").update(JSON.stringify(canonicalProposal(proposal)), "utf8").digest("hex");
}

export function inspectRepository(root: string, baseBranch = "main"): RepositoryInspection {
  const resolved = fs.realpathSync(path.resolve(root));
  if (!fs.existsSync(path.join(resolved, ".git"))) {
    throw new Error("Raiz não é um checkout Git.");
  }
  const currentBranch = git(resolved, ["branch", "--show-current"]);
  const head = git(resolved, ["rev-parse", "HEAD"]);
  const status = git(resolved, ["status", "--porcelain"]);
  const topLevel = fs.readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.name !== ".git")
    .map((entry) => entry.name + (entry.isDirectory() ? "/" : ""))
    .sort();
  const testFiles: string[] = [];
  const testRoot = path.join(resolved, "test");
  if (fs.existsSync(testRoot)) {
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (/\.(?:test|spec)\.(?:ts|tsx|js|mjs|cjs)$/i.test(entry.name)) {
          testFiles.push(path.relative(resolved, full).split(path.sep).join("/"));
        }
      }
    };
    visit(testRoot);
  }
  return { root: resolved, baseBranch, currentBranch, head, dirty: status.length > 0, topLevel, testFiles };
}

export function createIsolatedBranch(root: string, baseBranch: string, branchName: string): void {
  if (!/^lucky\/[a-z0-9][a-z0-9._-]{2,100}$/i.test(branchName)) {
    throw new Error("Nome de branch inválido. Use o prefixo lucky/.");
  }
  const normalizedBase = baseBranch.toLowerCase();
  if (normalizedBase === "main" || normalizedBase === "master") {
    // main/master are accepted only as immutable base, never as the development branch.
  }
  if (branchName.toLowerCase() === "main" || branchName.toLowerCase() === "master") {
    throw new Error("Autodesenvolvimento recusado: branch principal bloqueada.");
  }
  const branch = git(root, ["branch", "--show-current"]);
  if (branch === "main" || branch === "master") {
    throw new Error("A branch atual é principal; mudanças só podem ser feitas em uma branch Lucky isolada.");
  }
  if (branch) {
    throw new Error(`Branch isolada já ativa: ${branch}. O ciclo não troca branches automaticamente.`);
  }
  git(root, ["checkout", "-b", branchName, baseBranch]);
}

function safeTarget(root: string, relativePath: string): string {
  if (!relativePath.trim() || path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new Error(`Caminho inválido: ${relativePath}`);
  }
  const rawParts = relativePath.split(/[\\/]/);
  if (rawParts.some((part) => part === ".." || part === "")) {
    throw new Error(`Traversal bloqueado: ${relativePath}`);
  }
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  const parts = normalized.split("/");
  if (parts.some((part) => EXCLUDED.has(part) || part === ".env" || part.startsWith(".env."))) {
    throw new Error(`Arquivo protegido ou segredo bloqueado: ${relativePath}`);
  }
  if (PROTECTED_PATHS.has(normalized)) {
    throw new Error(`Arquivo protegido por integridade: ${relativePath}`);
  }
  if (parts[0] === "src" && (parts[1] === "kernel" || parts[1] === "security" || parts[1] === "testing")) {
    throw new Error(`Sistema de segurança ou testes protegido: ${relativePath}`);
  }
  if (parts[0] === "test" || parts[0] === "tests") {
    throw new Error(`Alteração direta de testes bloqueada: ${relativePath}`);
  }
  const target = path.resolve(root, ...relativePath.split("/"));
  const rel = path.relative(root, target);
  if (rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Caminho fora do repositório: ${relativePath}`);
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new Error(`Link simbólico bloqueado: ${relativePath}`);
  }
  return target;
}

export function applyRepositoryProposal(root: string, proposal: RepositoryProposal): void {
  if (!proposal.summary.trim() || !proposal.rationale.trim()) {
    throw new Error("A proposta precisa de resumo e justificativa.");
  }
  if (!Array.isArray(proposal.changes) || proposal.changes.length < 1 || proposal.changes.length > 30) {
    throw new Error("A proposta deve conter entre 1 e 30 arquivos.");
  }
  const seen = new Set<string>();
  for (const change of proposal.changes) {
    if (typeof change.content !== "string" || Buffer.byteLength(change.content, "utf8") > 1_000_000) {
      throw new Error("Conteúdo inválido ou maior que 1 MB.");
    }
    const target = safeTarget(root, change.path);
    const key = change.path.replaceAll("\\", "/").toLower
    if (seen.has(key)) throw new Error(`Arquivo repetido na proposta: ${change.path}`);
    seen.add(key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, change.content, "utf8");
  }
}

export function repositoryDiff(root: string): { diff: string; diffHash: string } {
  let diff = git(root, ["diff", "--no-ext-diff", "--binary", "--stat"]);
  diff += "\n" + git(root, ["diff", "--no-ext-diff", "--binary"]);
  const diffHash = createHash("sha256").update(diff, "utf8").digest("hex");
  return { diff, diffHash };
}

export async function runRepositoryDevelopmentCycle(options: RepositoryDevelopmentOptions): Promise<RepositoryDevelopmentResult> {
  const baseBranch = options.baseBranch ?? "main";
  const inspection = inspectRepository(options.projectRoot, baseBranch);
  if (inspection.dirty) {
    throw new Error("O desenvolvimento foi recusado: o checkout possui alterações locais não comprometidas.");
  }
  if (inspection.currentBranch !== baseBranch && baseBranch !== "") {
    throw new Error(`O checkout precisa estar em ${baseBranch} antes de iniciar o ciclo.`);
  }
  const testRunner = options.testRunner ?? ((root: string, timeoutMs?: number) => runSelfTests(root, timeoutMs));
  const baseline = await testRunner(inspection.root, options.timeoutMs);
  if (baseline.ok) {
    return {
      status: "BASELINE_PASSOU",
      inspection,
      branchName: options.branchName,
      baseline,
      finalTests: baseline,
      report: "A suíte já passou. Nenhuma proposta foi criada e nenhuma branch ou arquivo foi alterado.",
    };
  }

  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error("maxAttempts deve estar entre 1 e 3.");
  }

  let proposal: RepositoryProposal | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    proposal = await options.propose({ inspection, goal: options.goal, baseline });
    if (!proposal) {
      return { status: "PROPOSTA_RECUSADA", inspection, branchName: options.branchName, baseline, finalTests: baseline, report: "Nenhuma proposta foi recebida." };
    }

    const proposalHash = hashRepositoryProposal(proposal);
    createIsolatedBranch(inspection.root, baseBranch, options.branchName);

    try {
      applyRepositoryProposal(inspection.root, proposal);
    } catch (error) {
      return { status: "REPROVADO", inspection, branchName: options.branchName, proposalHash, baseline, finalTests: baseline, report: `Proposta bloqueada: ${(error as Error).message}` };
    }

    const finalTests = await testRunner(inspection.root, options.timeoutMs);
    if (!finalTests.ok) {
      if (attempt === maxAttempts) {
        const { diff, diffHash } = repositoryDiff(inspection.root);
        return { status: "REPROVADO", inspection, branchName: options.branchName, proposalHash, diffHash, diff, baseline, finalTests, report: `A proposta passou por ${attempt} tentativa(s), mas os testes ainda falham.` };
      }
      continue;
    }

    const { diff, diffHash } = repositoryDiff(inspection.root);
    if (!diff.trim()) {
      return { status: "REPROVADO", inspection, branchName: options.branchName, proposalHash, diffHash, diff, baseline, finalTests, report: "A proposta não produziu diferenças verificáveis." };
    }
    const approved = await options.authorizePublish({ proposal, proposalHash, diffHash, diff, branchName: options.branchName });
    if (!approved) {
      return { status: "APROVACAO_RECUSADA", inspection, branchName: options.branchName, proposalHash, diffHash, diff, baseline, finalTests, report: "Os testes passaram, mas a publicação foi recusada. Nenhuma alteração foi enviada ao GitHub." };
    }

    git(inspection.root, ["-c", "user.name=Lucky", "-c", "user.email=lucky@localhost", "add", "--all"]);
    git(inspection.root, ["-c", "user.name=Lucky", "-c", "user.email=lucky@localhost", "diff", "--cached", "--check"]);
    git(inspection.root, ["-c", "user.name=Lucky", "-c", "user.email=lucky@localhost", "commit", "-m", `Lucky: ${proposal.summary}`]);

    if (options.publishBranch) {
      await options.publishBranch(inspection.root, options.branchName);
    } else {
      git(inspection.root, ["push", "-u", "origin", `HEAD:refs/heads/${options.branchName}`]);
    }

    return {
      status: "VALIDADO_APROVADO",
      inspection,
      branchName: options.branchName,
      proposalHash,
      diffHash,
      diff,
      baseline,
      finalTests,
      report: `Alteração validada e publicada somente na branch ${options.branchName}. Nenhum merge em ${baseBranch} foi realizado.`,
    };
  }

  return { status: "REPROVADO", inspection, branchName: options.branchName, baseline, finalTests: baseline, report: "Limite de tentativas atingido." };
}
