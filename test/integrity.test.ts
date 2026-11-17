import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { formatIntegrityReport, verifyReleaseIntegrity } from "../src/security/integrity.ts";

const hash = (content: string) => createHash("sha256").update(content).digest("hex");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-integrity-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "policy.ts"), "export const locked = true;\n");
  return root;
}

test("verificador de integridade aceita arquivo idêntico ao manifesto", () => {
  const root = fixture();
  const content = "export const locked = true;\n";
  const report = verifyReleaseIntegrity(root, { "src/policy.ts": hash(content) });
  assert.equal(report.ok, true);
  assert.equal(report.checked, 1);
  assert.deepEqual(report.issues, []);
});

test("verificador reprova arquivo crítico alterado e gera mensagem de bloqueio", () => {
  const root = fixture();
  const report = verifyReleaseIntegrity(root, { "src/policy.ts": hash("versão oficial\n") });
  assert.equal(report.ok, false);
  assert.equal(report.issues[0]?.reason, "hash_mismatch");
  assert.match(formatIntegrityReport(report), /Inicialização bloqueada/);
});

test("verificador reprova arquivo crítico ausente e manifesto inválido", () => {
  const root = fixture();
  const report = verifyReleaseIntegrity(root, {
    "src/missing.ts": hash("x"),
    "src/policy.ts": "not-a-hash",
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.issues.map((x) => x.reason), ["missing", "invalid_manifest"]);
});

test("verificador não aceita links simbólicos como arquivos críticos", (t) => {
  const root = fixture();
  const link = path.join(root, "src", "linked.ts");
  try { fs.symlinkSync(path.join(root, "src", "policy.ts"), link); }
  catch { t.skip("criação de symlink não permitida neste ambiente"); return; }
  const report = verifyReleaseIntegrity(root, { "src/linked.ts": hash("export const locked = true;\n") });
  assert.equal(report.ok, false);
  assert.equal(report.issues[0]?.reason, "not_regular_file");
});
