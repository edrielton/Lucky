import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashCorrectionProposal, runSupervisedCorrection } from "../src/development/supervised.ts";
import { runSelfTests } from "../src/testing/runner.ts";

// Os testes unitários validam o ciclo de aprovação com fixtures confiáveis;
// o backend Docker real é verificado separadamente e não é simulado como seguro.
const testSandbox = { sandboxGuard: () => {}, testRunner: (root: string, timeout?: number) => runSelfTests(root, timeout) };

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-correction-fixture-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "lucky", type: "module" }));
  fs.mkdirSync(path.join(root, "test"));
  fs.writeFileSync(path.join(root, "test", "sample.test.js"), `import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; test('valor esperado', () => assert.equal(fs.readFileSync(new URL('../value.txt', import.meta.url), 'utf8').trim(), 'good'));`);
  fs.writeFileSync(path.join(root, "value.txt"), "bad\n");
  return root;
}

test("autocorreção corrige apenas a cópia e exige aprovação final", async () => {
  const root = fixture();
  let prompted = false;
  const result = await runSupervisedCorrection({
    projectRoot: root,
    ...testSandbox,
    propose: async () => ({ summary: "Corrigir valor de teste", changes: [{ path: "value.txt", content: "good\n" }] }),
    authorizeExecution: async () => true,
    approveReview: async () => { prompted = true; return true; },
  });
  assert.equal(result.status, "CORRECAO_VALIDADA_APROVADA_SEM_PROMOCAO");
  assert.equal(result.tests.ok, true);
  assert.equal(prompted, true);
  assert.equal(fs.readFileSync(path.join(root, "value.txt"), "utf8"), "bad\n", "a origem não pode mudar");
  assert.equal(fs.readFileSync(path.join(result.sandboxPath, "value.txt"), "utf8"), "good\n");
});

test("autocorreção bloqueia traversal e nunca promove", async () => {
  const root = fixture();
  const outside = path.join(path.dirname(root), "outside-lucky-test.txt");
  fs.writeFileSync(outside, "safe");
  const result = await runSupervisedCorrection({
    projectRoot: root,
    ...testSandbox,
    propose: async () => ({ summary: "tentativa inválida", changes: [{ path: "../outside-lucky-test.txt", content: "owned" }] }),
    authorizeExecution: async () => true,
    approveReview: async () => { throw new Error("não deveria pedir aprovação"); },
  });
  assert.equal(result.status, "REPROVADO");
  assert.match(result.report, /bloqueada|fora da sandbox/);
  assert.equal(fs.readFileSync(outside, "utf8"), "safe");
  assert.equal(fs.readFileSync(path.join(root, "value.txt"), "utf8"), "bad\n");
});

test("autocorreção valida limite de tentativas", async () => {
  const root = fixture();
  await assert.rejects(() => runSupervisedCorrection({ projectRoot: root, maxAttempts: 4, propose: async () => null, authorizeExecution: async () => false, approveReview: async () => false }), /entre 1 e 3/);
});

test("autocorreção não aplica nem executa uma proposta sem autorização explícita", async () => {
  const root = fixture();
  let reviewCalled = false;
  const result = await runSupervisedCorrection({
    projectRoot: root,
    ...testSandbox,
    propose: async () => ({ summary: "Correção proposta", changes: [{ path: "value.txt", content: "good\n" }] }),
    authorizeExecution: async () => false,
    approveReview: async () => { reviewCalled = true; return true; },
  });
  assert.equal(result.status, "EXECUCAO_NAO_AUTORIZADA");
  assert.equal(fs.readFileSync(path.join(root, "value.txt"), "utf8"), "bad\n");
  assert.equal(fs.readFileSync(path.join(result.sandboxPath, "value.txt"), "utf8"), "bad\n");
  assert.equal(reviewCalled, false);
});

test("autocorreção encerra sem propor mudanças quando a suíte base já passa", async () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "value.txt"), "good\n");
  let proposeCalled = false;
  let authorizeCalled = false;
  const result = await runSupervisedCorrection({
    projectRoot: root,
    ...testSandbox,
    propose: async () => { proposeCalled = true; return null; },
    authorizeExecution: async () => { authorizeCalled = true; return true; },
    approveReview: async () => true,
  });
  assert.equal(result.status, "BASELINE_PASSOU");
  assert.equal(result.attempts, 0);
  assert.equal(result.tests.ok, true);
  assert.equal(proposeCalled, false);
  assert.equal(authorizeCalled, false);
  assert.equal(fs.readFileSync(path.join(root, "value.txt"), "utf8"), "good\n");
});


test("hash da proposta muda quando muda qualquer conteúdo revisado", () => {
  const first = { summary: "ajuste", changes: [{ path: "src/example.ts", content: "export const x = 1;" }] };
  const second = { summary: "ajuste", changes: [{ path: "src/example.ts", content: "export const x = 2;" }] };
  assert.notEqual(hashCorrectionProposal(first), hashCorrectionProposal(second));
  assert.equal(hashCorrectionProposal(first), hashCorrectionProposal({ summary: "ajuste", changes: [{ path: "src/example.ts", content: "export const x = 1;" }] }));
});

test("autocorreção bloqueia alteração do kernel e criação de arquivos de teste", async () => {
  for (const target of ["src/kernel/policy.ts", "src/security/sandbox.ts", "src/memory/learning.ts", "test/evil.test.ts", "test/new.test.ts", "package.json"]) {
    const root = fixture();
    const original = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const result = await runSupervisedCorrection({
      projectRoot: root,
      ...testSandbox,
      propose: async () => ({ summary: "tentativa protegida", changes: [{ path: target, content: "alterado" }] }),
      authorizeExecution: async () => true,
      approveReview: async () => { throw new Error("não deveria pedir aprovação"); },
    });
    assert.equal(result.status, "REPROVADO", `destino deveria ser bloqueado: ${target}`);
    assert.match(result.report, /bloqueada|protegido|protegida|criação de arquivos/i);
    assert.equal(fs.readFileSync(path.join(root, "package.json"), "utf8"), original);
    assert.equal(fs.readFileSync(path.join(root, "value.txt"), "utf8"), "bad\n");
  }
});

test("autocorreção bloqueia autorização se o conteúdo mostrado for alterado durante a confirmação", async () => {
  const root = fixture();
  const result = await runSupervisedCorrection({
    projectRoot: root,
    ...testSandbox,
    propose: async () => ({ summary: "correção", changes: [{ path: "value.txt", content: "good\n" }] }),
    authorizeExecution: async ({ changes }) => { changes[0].content = "other\n"; return true; },
    approveReview: async () => { throw new Error("não deveria pedir revisão"); },
  });
  assert.equal(result.status, "REPROVADO");
  assert.match(result.report, /mudou durante a etapa de autorização/i);
  assert.equal(fs.readFileSync(path.join(root, "value.txt"), "utf8"), "bad\n");
});
