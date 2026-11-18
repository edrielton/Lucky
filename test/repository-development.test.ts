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
  type RepositoryDevelopmentOptions,
} from "../src/development/repository.ts";

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
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

const failedTests = {
  ok: false,
  isolation: "host" as const,
  exitCode: 1,
  signal: null,
  timedOut: false,
  durationMs: 1,
  testFiles: ["test/sample.test.js"],
  output: "falha simulada",
  report: "REPROVADO",
};

const passedTests = { ...failedTests, ok: true, exitCode: 0, report: "APROVADO" };

test("desenvolvimento Git rejeita checkout sujo e alterações em main", () => {
  const root = fixture();
  const inspection = inspectRepository(root, "main");
  assert.equal(inspection.currentBranch, "main");
  fs.writeFileSync(path.join(root, "local.txt"), "dirty");
  assert.throws(() => runRepositoryDevelopmentCycle({
    projectRoot: root,
    branchName: "lucky/test",
    goal: "testar",
    propose: async () => null,
    authorizePublish: async () => false,
  }), /alterações locais|checkout/);
});

 test("proposta muda o hash quando conteúdo ou justificativa mudam", () => {
  const first: RepositoryProposal = { summary: "ajuste", rationale: "motivo", changes: [{ path: "src/value.txt", content: "good" }] };
  const second: RepositoryProposal = { ...first, changes: [{ path: "src/value.txt", content: "other" }] };
  assert.notEqual(hashRepositoryProposal(first), hashRepositoryProposal(second));
});

test("patch aplica arquivo na branch isolada e bloqueia testes e segurança", () => {
  const root = fixture();
  git(root, "checkout", "-b", "lucky/patch-test");
  applyRepositoryProposal(root, { summary: "ajuste", rationale: "motivo", changes: [{ path: "src/value.txt", content: "good" }] });
  assert.equal(fs.readFileSync(path.join(root, "src/value.txt"), "utf8"), "good");
  assert.throws(() => applyRepositoryProposal(root, { summary: "bad", rationale: "bad", changes: [{ path: "test/evil.test.js", content: "x" }] }), /testes bloqueada/i);
  assert.throws(() => applyRepositoryProposal(root, { summary: "bad", rationale: "bad", changes: [{ path: "src/kernel/policy.ts", content: "x" }] }), /segurança|bloqueado/i);
});

 test("ciclo valida os testes e não publica quando a aprovação é recusada", async () => {
  const root = fixture();
  let published = false;
  let testCalls = 0;
  const options: RepositoryDevelopmentOptions = {
    projectRoot: root,
    branchName: "lucky/functional-cycle",
    goal: "corrigir value",
    propose: async () => ({ summary: "corrigir valor", rationale: "A implementação deve usar good.", changes: [{ path: "src/value.txt", content: "good" }] }),
    authorizePublish: async () => false,
    testRunner: async () => (++testCalls === 1 ? failedTests : passedTests),
    publishBranch: async () => { published = true; },
  };
  const result = await runRepositoryDevelopmentCycle(options);
  assert.equal(result.status, "APROVACAO_RECUSADA");
  assert.equal(published, false);
  assert.ok(result.proposalHash);
  assert.ok(result.diffHash);
  assert.equal(fs.readFileSync(path.join(root, "src/value.txt"), "utf8"), "good");
});

 test("ciclo aprovado cria commit local e chama publicador somente após aprovação", async () => {
  const root = fixture();
  let published = false;
  let testCalls = 0;
  const result = await runRepositoryDevelopmentCycle({
    projectRoot: root,
    branchName: "lucky/published-cycle",
    goal: "corrigir value",
    propose: async () => ({ summary: "corrigir valor", rationale: "A implementação deve usar good.", changes: [{ path: "src/value.txt", content: "good" }] }),
    authorizePublish: async () => true,
    testRunner: async () => (++testCalls === 1 ? failedTests : passedTests),
    publishBranch: async (publishedRoot, branchName) => {
      published = true;
      assert.equal(branchName, "lucky/published-cycle");
      assert.equal(git(publishedRoot, "branch", "--show-current"), undefined);
    },
  });
  assert.equal(result.status, "VALIDADO_APROVADO");
  assert.equal(published, true);
  assert.equal(git(root, "branch", "--show-current"), undefined);
});
