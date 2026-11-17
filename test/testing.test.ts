import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSelfTests } from "../src/testing/runner.ts";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-selftest-"));
  fs.mkdirSync(path.join(root, "test"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "lucky", type: "module", scripts: {} }));
  return root;
}

test("executor autónomo aprova uma suíte válida e produz relatório", async () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "test", "ok.test.js"), `import { test } from 'node:test'; import assert from 'node:assert/strict'; test('ok', () => assert.equal(2 + 2, 4));`);
  const r = await runSelfTests(root);
  assert.equal(r.ok, true, r.output);
  assert.equal(r.exitCode, 0);
  assert.equal(r.testFiles.length, 1);
  assert.match(r.report, /APROVADO/);
  assert.match(r.output, /ok/);
});

test("executor autónomo reprova suíte com falha", async () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "test", "broken.test.js"), `import { test } from 'node:test'; import assert from 'node:assert/strict'; test('broken', () => assert.equal(2 + 2, 5));`);
  const r = await runSelfTests(root);
  assert.equal(r.ok, false);
  assert.notEqual(r.exitCode, 0);
  assert.match(r.report, /REPROVADO/);
});

test("executor autónomo recusa raiz que não seja Lucky e ausência de testes", async () => {
  const wrong = fs.mkdtempSync(path.join(os.tmpdir(), "not-lucky-"));
  fs.writeFileSync(path.join(wrong, "package.json"), JSON.stringify({ name: "not-lucky" }));
  await assert.rejects(() => runSelfTests(wrong), /não parece ser o projeto Lucky/);

  const root = fixture();
  const r = await runSelfTests(root);
  assert.equal(r.ok, false);
  assert.match(r.report, /Nenhum arquivo de teste/);
});

test("executor autónomo não repassa variáveis com nomes de segredo", async () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "test", "env.test.js"), `import { test } from 'node:test'; import assert from 'node:assert/strict'; test('secret filtered', () => assert.equal(process.env.LUCKY_TEST_SECRET, undefined));`);
  process.env.LUCKY_TEST_SECRET = "must-not-leak";
  try {
    const r = await runSelfTests(root);
    assert.equal(r.ok, true, r.output);
  } finally {
    delete process.env.LUCKY_TEST_SECRET;
  }
});


test("executor autónomo interrompe uma suíte que excede o timeout", async () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "test", "hang.test.js"), `await new Promise((resolve) => setTimeout(resolve, 15000));`);
  const r = await runSelfTests(root, 1000);
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.match(r.report, /Limite de tempo excedido/);
});
