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
  if (branch !== baseBranch) {
    throw new Error(`O checkout precisa estar em ${baseBranch} para criar a branch isolada.`);
  }
  const existing = git(root, ["branch", "--list", branchName]);
  if (existing) throw new Error(`A branch ${branchName} já existe; escolha outro nome para não sobrescrever trabalho anterior.`);
  git(root, ["checkout", "-b", branchName, baseBranch]);
}

function safeTarget(root: string, relativePath: string): string {
  if (!relativePath.trim() || path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new Error(`Caminho inválido: ${relativePath}`);
  }
  const rawParts = relativePath.split(/[\\/]/);
  if (rawParts.some((part) => part === ".." || part === "" || part === ".")) {
    throw new Error(`Traversal ou segmento inválido bloqueado: ${relativePath}`);
  }
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  const parts = normalized.split("/");
  if (parts.some((part) => EXCLUDED.has(part) || part === ".env" || part.startsWith(".env."))) {
    throw new Error(`Arquivo protegido ou segredo bloqueado: ${relativePath}`);
  }
  if (PROTECTED_PATHS.has(normalized)) {
    throw new Error(`Arquivo protegido por integridade: ${relativePath}`);
  }
  if (parts[0] === ".github" ||
      (parts[0] === "src" && ["kernel", "security", "testing", "development"].includes(parts[1] ?? ""))) {
    throw new Error(`Sistema de segurança, desenvolvimento ou CI protegido: ${relativePath}`);
  }
  if (parts[0] === "test" || parts[0] === "tests") {
    throw new Error(`Alteração direta de testes bloqueada: ${relativePath}`);
  }
  const target = path.resolve(root, ...rawParts);
  const rel = path.relative(root, target);
  if (rel.startsWith(`..${path.sep}`) || rel === ".." || path.isAbsolute(rel)) {
    throw new Error(`Caminho fora do repositório: ${relativePath}`);
  }
  let cursor = root;
  for (const part of rawParts.slice(0, -1)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error(`Link simbólico no caminho bloqueado: ${relativePath}`);
      if (!stat.isDirectory()) throw new Error(`Componente do caminho não é diretório: ${relativePath}`);
    }
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new Error(`Link simbólico bloqueado: ${relativePath}`);
  }
  if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) {
    throw new Error(`O destino precisa ser um arquivo regular: ${relativePath}`);
  }
  return target;
}

export function applyRepositoryProposal(root: string, proposal: RepositoryProposal): void {
  if (!proposal || typeof proposal.summary !== "string" || !proposal.summary.trim() ||
      typeof proposal.rationale !== "string" || !proposal.rationale.trim()) {
    throw new Error("A proposta precisa de resumo e justificativa.");
  }
  if (!Array.isArray(proposal.changes) || proposal.changes.length < 1 || proposal.changes.length > 30) {
    throw new Error("A proposta deve conter entre 1 e 30 arquivos.");
  }

  // Validate every path and duplicate before writing anything: a bad last item
  // must not leave a partially applied proposal in the working tree.
  const prepared: Array<{ target: string; content: string }> = [];
  const seen = new Set<string>();
  for (const change of proposal.changes) {
    if (!change || typeof change.content !== "string" || Buffer.byteLength(change.content, "utf8") > 1_000_000) {
      throw new Error("Conteúdo inválido ou maior que 1 MB.");
    }
    const target = safeTarget(root, change.path);
    const key = path.relative(root, target).split(path.sep).join("/").toLowerCase();
    if (seen.has(key)) throw new Error(`Arquivo repetido na proposta: ${change.path}`);
    seen.add(key);
    prepared.push({ target, content: change.content });
  }
  for (const item of prepared) {
    fs.mkdirSync(path.dirname(item.target), { recursive: true });
    fs.writeFileSync(item.target, item.content, "utf8");
  }
}

export function repositoryDiff(root: string): { diff: string; diffHash: string } {
  let diff = git(root, ["diff", "--cached", "--no-ext-diff", "--binary", "--stat"]);
  diff += "\n" + git(root, ["diff", "--cached", "--no-ext-diff", "--binary"]);
  const names = git(root, ["diff", "--cached", "--name-only"]);
  diff += "\n--- staged paths ---\n" + names;
  const diffHash = createHash("sha256").update(diff, "utf8").digest("hex");
  return { diff, diffHash };
}

export async function runRepositoryDevelopmentCycle(options: RepositoryDevelopmentOptions): Promise<RepositoryDevelopmentResult> {
  const baseBranch = options.baseBranch ?? "main";
  const inspection = inspectRepository(options.projectRoot, baseBranch);
  if (inspection.dirty) {
    throw new Error("O desenvolvimento foi recusado: o checkout possui alterações locais não comprometidas.");
  }
  if (inspection.currentBranch !== baseBranch) {
    throw new Error(`O checkout precisa estar em ${baseBranch} antes de iniciar o ciclo.`);
  }

  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error("maxAttempts deve estar entre 1 e 3.");
  }

  const baselineRunner = options.testRunner ?? ((root: string, timeoutMs?: number) => runSelfTests(root, timeoutMs));
  const candidateRunner = options.testRunner ??
    ((root: string, timeoutMs?: number) => runSelfTests(root, timeoutMs, { isolation: "docker" }));
  const baseline = await baselineRunner(inspection.root, options.timeoutMs);
  if (!baseline.ok) {
    return {
      status: "REPROVADO",
      inspection,
      branchName: options.branchName,
      baseline,
      finalTests: baseline,
      report: "A suíte de referência falhou antes de qualquer alteração. O autodesenvolvimento foi interrompido; corrija ou investigue a base primeiro.",
    };
  }

  let branchCreated = false;
  let lastTests = baseline;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const proposal = await options.propose({ inspection, goal: options.goal, baseline: lastTests });
    if (!proposal) {
      return {
        status: "PROPOSTA_RECUSADA", inspection, branchName: options.branchName,
        baseline, finalTests: lastTests,
        report: "Nenhuma proposta válida foi recebida. Nenhuma alteração foi publicada.",
      };
    }

    const proposalHash = hashRepositoryProposal(proposal);
    if (!branchCreated) {
      createIsolatedBranch(inspection.root, baseBranch, options.branchName);
      branchCreated = true;
    } else {
      // Each attempt starts from the exact base commit, not from a failed patch.
      git(inspection.root, ["reset", "--hard", inspection.head]);
    }

    try {
      applyRepositoryProposal(inspection.root, proposal);
    } catch (error) {
      return {
        status: "REPROVADO", inspection, branchName: options.branchName, proposalHash,
        baseline, finalTests: lastTests,
        report: `Proposta bloqueada antes da execução: ${(error as Error).message}. Nenhum arquivo da proposta foi parcialmente aplicado.`,
      };
    }

    const finalTests = await candidateRunner(inspection.root, options.timeoutMs);
    lastTests = finalTests;
    if (!finalTests.ok) {
      if (attempt < maxAttempts) continue;
      const { diff, diffHash } = repositoryDiff(inspection.root);
      return {
        status: "REPROVADO", inspection, branchName: options.branchName,
        proposalHash, diffHash, diff, baseline, finalTests,
        report: `Limite de ${maxAttempts} tentativas atingido. Os testes da proposta continuam reprovados; nada foi publicado.`,
      };
    }

    // Stage only the exact, validated proposal paths. No unrelated or untracked
    // workspace file can silently enter the commit.
    git(inspection.root, ["--literal-pathspecs", "add", "--", ...proposal.changes.map((change) => change.path)]);
    const stagedNames = git(inspection.root, ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean).sort();
    const expectedNames = proposal.changes.map((change) => change.path.replaceAll("\\", "/")).sort();
    if (JSON.stringify(stagedNames) !== JSON.stringify(expectedNames)) {
      return {
        status: "REPROVADO", inspection, branchName: options.branchName,
        proposalHash, baseline, finalTests,
        report: "O conjunto de arquivos preparados não corresponde exatamente à proposta. Publicação bloqueada.",
      };
    }
    const { diff, diffHash } = repositoryDiff(inspection.root);
    if (!diff.trim()) {
      return {
        status: "REPROVADO", inspection, branchName: options.branchName,
        proposalHash, diffHash, diff, baseline, finalTests,
        report: "A proposta não produziu diferenças verificáveis.",
      };
    }

    const approved = await options.authorizePublish({
      proposal, proposalHash, diffHash, diff, branchName: options.branchName,
    });
    // Re-check the exact staged content after the human decision.
    const afterApproval = repositoryDiff(inspection.root);
    if (afterApproval.diffHash !== diffHash) {
      return {
        status: "REPROVADO", inspection, branchName: options.branchName,
        proposalHash, diffHash: afterApproval.diffHash, diff: afterApproval.diff,
        baseline, finalTests,
        report: "O diff mudou durante a aprovação. A publicação foi bloqueada.",
      };
    }
    if (!approved) {
      return {
        status: "APROVACAO_RECUSADA", inspection, branchName: options.branchName,
        proposalHash, diffHash, diff, baseline, finalTests,
        report: "Os testes passaram, mas a publicação foi recusada. Nenhuma alteração foi enviada ao GitHub.",
      };
    }

    git(inspection.root, ["diff", "--cached", "--check"]);
    git(inspection.root, ["-c", "user.name=Lucky", "-c", "user.email=lucky@localhost", "commit", "-m", `Lucky: ${proposal.summary}`]);

    if (options.publishBranch) {
      await options.publishBranch(inspection.root, options.branchName);
    } else {
      git(inspection.root, ["push", "-u", "origin", `HEAD:refs/heads/${options.branchName}`]);
    }

    return {
      status: "VALIDADO_APROVADO", inspection, branchName: options.branchName,
      proposalHash, diffHash, diff, baseline, finalTests,
      report: `Alteração validada e publicada somente na branch ${options.branchName}. Nenhum merge em ${baseBranch} foi realizado.`,
    };
  }

  return {
    status: "REPROVADO", inspection, branchName: options.branchName,
    baseline, finalTests: lastTests,
    report: "O ciclo foi encerrado sem uma proposta aprovada.",
  };
}
