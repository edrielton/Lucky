import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { runSelfTests, type TestRunResult } from "../testing/runner.ts";
import { requireSandboxCapability } from "../security/sandbox.ts";

export interface ProposedFileChange {
  path: string;
  content: string;
}
export interface CorrectionProposal {
  summary: string;
  changes: ProposedFileChange[];
}
export interface SupervisedCorrectionOptions {
  projectRoot: string;
  maxAttempts?: number;
  propose: (context: { attempt: number; previousReport: TestRunResult; sandboxPath: string }) => Promise<CorrectionProposal | null>;
  /** Explicitly authorizes applying a proposed patch and executing the changed test code. */
  authorizeExecution: (context: { attempt: number; summary: string; changes: ProposedFileChange[]; sandboxPath: string; proposalHash: string }) => Promise<boolean>;
  /** Reviews a validated result. Approval does not copy files to the original project. */
  approveReview: (context: { summary: string; sandboxPath: string; testReport: TestRunResult; attempts: number; proposalHash: string }) => Promise<boolean>;
  timeoutMs?: number;
  /** Injeção exclusiva para testes unitários; a aplicação não deve fornecer estes campos. */
  sandboxGuard?: () => void;
  testRunner?: (root: string, timeoutMs?: number) => Promise<TestRunResult>;
}
export interface SupervisedCorrectionResult {
  status: "BASELINE_PASSOU" | "CORRECAO_VALIDADA_APROVADA_SEM_PROMOCAO" | "REPROVADO" | "PROPOSTA_RECUSADA" | "EXECUCAO_NAO_AUTORIZADA" | "REVISAO_NEGADA";
  sandboxPath: string;
  attempts: number;
  tests: TestRunResult;
  report: string;
  proposalHash?: string;
}

const EXCLUDED = new Set([".git", "node_modules"]);
const isSecretEnvFile = (name: string) => {
  const lower = name.toLowerCase();
  return lower === ".env" || lower.startsWith(".env.");
};

function copyProject(source: string, destination: string): void {
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: false,
    filter: (entry) => {
      const relative = path.relative(source, entry);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      if (parts.some((part) => EXCLUDED.has(part.toLowerCase()) || isSecretEnvFile(part))) return false;
      const stat = fs.lstatSync(entry);
      // Do not carry symlinks into the correction workspace.
      return !stat.isSymbolicLink();
    },
  });
}

/** Hash is bound to the exact summary, paths, and contents shown to the human. */
export function hashCorrectionProposal(proposal: CorrectionProposal): string {
  const canonical = JSON.stringify({
    summary: proposal.summary,
    changes: proposal.changes.map(({ path: filePath, content }) => ({ path: filePath.replaceAll("\\", "/"), content })),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

const PROTECTED_EXACT = new Set([
  "package.json", "package-lock.json", "npm-shrinkwrap.json", "tsconfig.json",
  "src/development/supervised.ts", "src/development/proposal.ts",
  "src/bridge/server.ts", "pc-extension/manifest.json",
]);

function safeTarget(root: string, relativePath: string): string {
  if (typeof relativePath !== "string" || !relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error("Caminho de alteração inválido: use um caminho relativo dentro da sandbox.");
  }
  const rawParts = relativePath.split(/[\\/]/);
  if (rawParts.some((part) => part === "..")) {
    throw new Error(`Caminho de alteração bloqueado: ${relativePath}`);
  }
  const normalized = path.normalize(relativePath);
  const parts = normalized.split(path.sep);
  const portable = normalized.split(path.sep).join("/").toLowerCase();
  if (parts.some((part) => EXCLUDED.has(part.toLowerCase()) || isSecretEnvFile(part)) || normalized === ".") {
    throw new Error(`Caminho de alteração bloqueado: ${relativePath}`);
  }
  if (PROTECTED_EXACT.has(portable) || portable.startsWith("test/") || portable.startsWith("tests/") || portable.startsWith("src/kernel/") || portable.startsWith("src/testing/") || portable.startsWith("src/security/") || portable.startsWith("src/memory/")) {
    throw new Error(`Arquivo protegido: ${relativePath}. O ciclo automático não pode alterar testes, políticas de segurança, quality gate ou metadados do projeto.`);
  }
  const target = path.resolve(root, normalized);
  const rel = path.relative(root, target);
  if (rel.startsWith(`..${path.sep}`) || rel === ".." || path.isAbsolute(rel)) {
    throw new Error(`Caminho fora da sandbox: ${relativePath}`);
  }
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`Alteração através de link simbólico bloqueada: ${relativePath}`);
    }
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new Error(`Não é permitido substituir link simbólico: ${relativePath}`);
  }
  if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) {
    throw new Error(`A autocorreção só pode modificar arquivos regulares existentes; criação de arquivos é bloqueada: ${relativePath}`);
  }
  return target;
}

function applyProposal(root: string, proposal: CorrectionProposal): void {
  if (!proposal || typeof proposal.summary !== "string" || !proposal.summary.trim()) {
    throw new Error("A proposta precisa de um resumo não vazio.");
  }
  if (!Array.isArray(proposal.changes) || proposal.changes.length === 0 || proposal.changes.length > 50) {
    throw new Error("A proposta deve conter entre 1 e 50 alterações de arquivo.");
  }
  const seen = new Set<string>();
  for (const change of proposal.changes) {
    if (!change || typeof change.content !== "string") throw new Error("Conteúdo de arquivo inválido.");
    const target = safeTarget(root, change.path);
    const key = path.relative(root, target);
    if (seen.has(key)) throw new Error(`Arquivo repetido na proposta: ${change.path}`);
    const portableKey = key.split(path.sep).join("/").toLowerCase();
    if ((portableKey.startsWith("test/") || portableKey.startsWith("tests/")) && fs.existsSync(target)) {
      throw new Error(`Alteração de teste existente bloqueada para impedir enfraquecimento da suíte: ${change.path}`);
    }
    seen.add(key);
    if (Buffer.byteLength(change.content, "utf8") > 1_000_000) throw new Error(`Arquivo excede 1 MB: ${change.path}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, change.content, { encoding: "utf8", flag: "w" });
  }
}

/**
 * Executes a bounded correction loop in a disposable copy. It never writes back
 * to the original project. Approval is a separate, explicit final decision;
 * this module does not publish or promote files to production.
 */
export async function runSupervisedCorrection(options: SupervisedCorrectionOptions): Promise<SupervisedCorrectionResult> {
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error("maxAttempts deve estar entre 1 e 3.");
  }
  // Fail closed: a disposable directory alone is not an OS security boundary.
  (options.sandboxGuard ?? requireSandboxCapability)();
  const testRunner = options.testRunner ?? ((root: string, timeout?: number) => runSelfTests(root, timeout, { isolation: "docker" }));
  const source = fs.realpathSync(path.resolve(options.projectRoot));
  const pkgPath = path.join(source, "package.json");
  if (!fs.existsSync(pkgPath) || (JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string }).name !== "lucky") {
    throw new Error("Autocorreção recusada: a raiz não parece ser o projeto Lucky.");
  }
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-supervised-"));
  const sandboxPath = path.join(parent, "project");
  fs.mkdirSync(sandboxPath);
  copyProject(source, sandboxPath);

  let tests = await testRunner(sandboxPath, options.timeoutMs);
  if (tests.ok) {
    return { status: "BASELINE_PASSOU", sandboxPath, attempts: 0, tests, report: "A suíte já passa na cópia isolada. Nenhuma alteração foi proposta nem aplicada." };
  }

  let lastSummary = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const proposal = await options.propose({ attempt, previousReport: tests, sandboxPath });
    if (!proposal) {
      return { status: "PROPOSTA_RECUSADA", sandboxPath, attempts: attempt - 1, tests, report: "O ciclo foi encerrado sem proposta de correção. O projeto original não foi alterado." };
    }
    let proposalHash: string;
    try {
      proposalHash = hashCorrectionProposal(proposal);
    } catch (error) {
      return { status: "REPROVADO", sandboxPath, attempts: attempt, tests, report: `Proposta inválida: ${(error as Error).message}. O projeto original não foi alterado.` };
    }
    const presentedChanges = proposal.changes.map((change) => ({ ...change }));
    const authorized = await options.authorizeExecution({
      attempt,
      summary: proposal.summary,
      changes: presentedChanges,
      sandboxPath,
      proposalHash,
    });
    if (hashCorrectionProposal(proposal) !== proposalHash || hashCorrectionProposal({ summary: proposal.summary, changes: presentedChanges }) !== proposalHash) {
      return { status: "REPROVADO", sandboxPath, attempts: attempt, tests, proposalHash, report: "A proposta mudou durante a etapa de autorização. Alteração e execução bloqueadas." };
    }
    if (!authorized) {
      return { status: "EXECUCAO_NAO_AUTORIZADA", sandboxPath, attempts: attempt - 1, tests, report: "A proposta não foi aplicada nem executada porque a autorização foi negada. O projeto original não foi alterado." };
    }
    try {
      applyProposal(sandboxPath, proposal);
    } catch (error) {
      return { status: "REPROVADO", sandboxPath, attempts: attempt, tests, report: `Proposta bloqueada: ${(error as Error).message}. O projeto original não foi alterado.` };
    }
    lastSummary = proposal.summary;
    tests = await testRunner(sandboxPath, options.timeoutMs);
    if (!tests.ok) continue;

    const approved = await options.approveReview({ summary: lastSummary, sandboxPath, testReport: tests, attempts: attempt, proposalHash });
    if (!approved) {
      return { status: "REVISAO_NEGADA", sandboxPath, attempts: attempt, tests, proposalHash, report: "Correção passou na suíte da cópia isolada, mas a revisão humana foi negada. Nada foi promovido ao projeto original." };
    }
    return { status: "CORRECAO_VALIDADA_APROVADA_SEM_PROMOCAO", sandboxPath, attempts: attempt, tests, proposalHash, report: `Correção aprovada para revisão manual após os testes. Hash SHA-256: ${proposalHash}. Nenhum arquivo foi copiado ao projeto original; a promoção é uma etapa separada e não é executada por este módulo.` };
  }
  return { status: "REPROVADO", sandboxPath, attempts: maxAttempts, tests, report: `Limite de ${maxAttempts} tentativas atingido. Última proposta: ${lastSummary || "nenhuma"}. O projeto original não foi alterado.` };
}
