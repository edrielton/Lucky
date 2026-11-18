import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  applyRepositoryProposal,
  hashRepositoryProposal,
  inspectRepository,
  runRepositoryDevelopmentCycle,
  type RepositoryProposal,
} from "../src/development/repository.ts";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
}

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-repository-cycle-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "lucky", type: "module" }));
  fs.mkdirSync(path.join(root, "test"));
  fs.writeFileSync(path.join(root, "test", "sample.test.js"), "import { test } from 'node:test'; test('baseline', () => {});\n");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "value.txt"), "bad\n");
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Lucky Test");
  git(root, "config", "user.email", "lucky@example.test");
  git(root, "add", "--all");
  git(root, "commit", "-m", "baseline");
  return root;
}

const passedTests = {
  ok: true,
  isolation: "host" as const,
  exitCode: 0,
  signal: null,
  timedOut: false,
  durationMs: 1,
  testFiles: ["test/sample.test.js"],
  output: "# tests 1\n",
  report: "APROVADO",
};

const failedTests = { ...passedTests, ok: false, exitCode: 1, output: "falha simulada", report: "REPROVADO" };

test("inspeção identifica branch, HEAD, arquivos e estado sujo", () => {
  const root = fixture();
  const inspection = inspectRepository(root, "main");
  assert.equal(inspection.currentBranch, "main");
  assert.equal(inspection.dirty, false);
  assert.equal(inspection.testFiles.length, 1);
  fs.writeFileSync(path.join(root, "local.txt"), "dirty");
  assert.equal(inspectRepository(root, "main").dirty, true);
});

test("hash da proposta muda quando conteúdo ou justificativa mudam", () => {
  const first: RepositoryProposal = { summary: "ajuste", rationale: "motivo", changes: [{ path: "src/value.txt", content: "good" }] };
  const second: RepositoryProposal = { ...first, changes: [{ path: "src/value.txt", content: "other" }] };
  const third: RepositoryProposal = { ...first, rationale: "outro motivo" };
  assert.notEqual(hashRepositoryProposal(first), hashRepositoryProposal(second));
  assert.notEqual(hashRepositoryProposal(first), hashRepositoryProposal(third));
});

test("patch valida todos os caminhos antes de gravar e bloqueia traversal, testes e segurança", () => {
  const root = fixture();
  git(root, "checkout", "-b", "lucky/patch-test");
  assert.throws(() => applyRepositoryProposal(root, {
    summary: "proposta inválida", rationale: "deve ser atômica",
    changes: [
      { path: "src/value.txt", content: "should-not-write" },
      { path: "../outside.txt", content: "escape" },
    ],
  }), /Traversal.*bloqueado|Caminho fora/i);
  assert.equal(fs.readFileSync(path.join(root, "src/value.txt"), "utf8"), "bad\n");
  assert.throws(() => applyRepositoryProposal(root, { summary: "bad", rationale: "bad", changes: [{ path: "test/evil.test.js", content: "x" }] }), /testes bloqueada/i);
  assert.throws(() => applyRepositoryProposal(root, { summary: "bad", rationale: "bad", changes: [{ path: "src/kernel/policy.ts", content: "x" }] }), /segurança|bloqueado/i);
});

test("ciclo não propõe alterações se a suíte de referência falhar", async () => {
  const root = fixture();
  let proposed = false;
  const result = await runRepositoryDevelopmentCycle({
    projectRoot: root,
    branchName: "lucky/baseline-failure",
    goal: "melhorar o sistema",
    propose: async () => { proposed = true; return null; },
    authorizePublish: async () => false,
    testRunner: async () => failedTests,
  });
  assert.equal(result.status, "REPROVADO");
  assert.equal(proposed, false);
  assert.equal(git(root, "branch", "--show-current"), "main");
});

test("ciclo cria branch isolada após baseline aprovado e não publica sem autorização", async () => {
  const root = fixture();
  let published = false;
  let testCalls = 0;
  const result = await runRepositoryDevelopmentCycle({
    projectRoot: root,
    branchName: "lucky/functional-cycle",
    goal: "corrigir o valor",
    propose: async ({ baseline }) => {
      assert.equal(baseline.ok, true);
      return { summary: "corrigir valor", rationale: "O conteúdo correto é good.", changes: [{ path: "src/value.txt", content: "good\n" }] };
    },
    authorizePublish: async ({ proposalHash, diffHash, diff }) => {
      assert.match(proposalHash, /^[a-f0-9]{64}$/);
      assert.match(diffHash, /^[a-f0-9]{64}$/);
      assert.match(diff, /good/);
      return false;
    },
    testRunner: async () => { testCalls++; return passedTests; },
    publishBranch: async () => { published = true; },
  });
  assert.equal(result.status, "APROVACAO_RECUSADA");
  assert.equal(testCalls, 2);
  assert.equal(published, false);
  assert.ok(result.proposalHash);
  assert.ok(result.diffHash);
  assert.equal(git(root, "branch", "--show-current"), "lucky/functional-cycle");
  assert.equal(fs.readFileSync(path.join(root, "src/value.txt"), "utf8"), "good\n");
});

test("ciclo restaura a base entre tentativas e só publica após aprovação", async () => {
  const root = fixture();
  let testCalls = 0;
  let proposalCalls = 0;
  let published = false;
  const result = await runRepositoryDevelopmentCycle({
    projectRoot: root,
    branchName: "lucky/retry-cycle",
    goal: "corrigir valor",
    maxAttempts: 2,
    propose: async ({ baseline }) => {
      proposalCalls++;
      assert.equal(baseline.ok, proposalCalls === 1 ? true : false);
      return { summary: `correção ${proposalCalls}`, rationale: "ajuste mínimo", changes: [{ path: "src/value.txt", content: `good-${proposalCalls}\n` }] };
    },
    authorizePublish: async () => true,
    testRunner: async () => (++testCalls === 2 ? failedTests : passedTests),
    publishBranch: async (publishedRoot, branchName) => {
      published = true;
      assert.equal(branchName, "lucky/retry-cycle");
      assert.equal(git(publishedRoot, "branch", "--show-current"), "lucky/retry-cycle");
    },
  });
  assert.equal(result.status, "VALIDADO_APROVADO");
  assert.equal(proposalCalls, 2);
  assert.equal(testCalls, 3);
  assert.equal(published, true);
  assert.equal(fs.readFileSync(path.join(root, "src/value.txt"), "utf8"), "good-2\n");
  assert.equal(git(root, "log", "-1", "--pretty=%s"), "Lucky: correção 2");
});
