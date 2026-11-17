import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/db.ts";
import { LearningEngine } from "../src/memory/learning.ts";
import { Store } from "../src/store.ts";
import { buildDockerSandboxArgs, DEFAULT_SANDBOX_LIMITS, resolveSandboxPath, validateSandboxLimits } from "../src/security/sandbox.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lucky-sandbox-test-"));

test("memória estruturada preserva tipo, confiança, tags e metadados", () => {
  const store = new Store(openDb(tmp()));
  store.addMemory({ kind: "procedural", content: "Executar testes antes de aprovar", confidence: "confirmed", source: "user", tags: ["qa", "workflow"], metadata: { version: "0.2.6" } });
  const items = store.listStructuredMemory();
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "procedural");
  assert.deepEqual(items[0].tags, ["qa", "workflow"]);
  assert.equal(items[0].metadata.version, "0.2.6");
});

test("remember mantém compatibilidade com a tabela antiga e migra registros legados", () => {
  const db = openDb(tmp());
  db.exec("CREATE TABLE memory(id INTEGER PRIMARY KEY AUTOINCREMENT, confidence TEXT, text TEXT, source TEXT, created TEXT)");
  db.prepare("INSERT INTO memory(confidence,text,source,created) VALUES(?,?,?,?)").run("confirmed", "memória anterior", "usuário", new Date().toISOString());
  const store = new Store(db);
  assert.equal(store.listMemory().length, 1);
  assert.equal(store.listStructuredMemory().length, 1);
  assert.equal(store.listStructuredMemory()[0].content, "memória anterior");
  store.remember("confirmed", "Preferir testes reproduzíveis", "usuário");
  assert.equal(store.listMemory().length, 2);
  assert.equal(store.listStructuredMemory().length, 2);
});

test("Learning Engine só registra padrão após duas falhas equivalentes", () => {
  const store = new Store(openDb(tmp()));
  const engine = new LearningEngine(store);
  store.recordExperience({ kind: "error", context: "tool:read_file", action: "exception", result: "arquivo não encontrado" });
  assert.equal(engine.analyze().recurringFailures, 0);
  store.recordExperience({ kind: "error", context: "tool:read_file", action: "exception", result: "arquivo não encontrado" });
  const analysis = engine.analyze();
  assert.equal(analysis.examined, 2);
  assert.equal(analysis.recurringFailures, 1);
  assert.equal(engine.listInsights()[0].occurrences, 2);
});

test("sandbox bloqueia traversal, links simbólicos e aceita caminho interno", () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, "safe"));
  fs.writeFileSync(path.join(root, "safe", "file.txt"), "ok");
  assert.equal(resolveSandboxPath(root, "safe/file.txt"), path.join(root, "safe", "file.txt"));
  assert.throws(() => resolveSandboxPath(root, "../outside"), /Traversal|fora da sandbox/);
  const outside = tmp();
  fs.symlinkSync(outside, path.join(root, "escape"));
  assert.throws(() => resolveSandboxPath(root, "escape/secret.txt"), /Link simbólico bloqueado/);
});

test("limites de sandbox são validados e Docker recebe restrições explícitas", () => {
  validateSandboxLimits({ ...DEFAULT_SANDBOX_LIMITS });
  assert.throws(() => validateSandboxLimits({ ...DEFAULT_SANDBOX_LIMITS, memoryMb: 32 }), /RAM inválido/);
  const args = buildDockerSandboxArgs(tmp(), ["node", "--version"]);
  assert.ok(args.includes("none"));
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("--cap-drop"));
  assert.ok(args.includes("ALL"));
  assert.ok(args.includes("--memory"));
  assert.ok(args.includes("--pids-limit"));
  assert.ok(args.includes("node:22.18-alpine"));
});
