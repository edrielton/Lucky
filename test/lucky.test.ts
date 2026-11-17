import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgent, type AgentDeps } from "../src/agent/loop.ts";
import { openDb } from "../src/db.ts";
import { ApprovalGate, actionHash } from "../src/kernel/approval.ts";
import { Audit } from "../src/kernel/audit.ts";
import { decideCommand, resolveInside } from "../src/kernel/policy.ts";
import { Store } from "../src/store.ts";
import { builtinTools } from "../src/tools/builtin.ts";
import type { Mode, ModelProvider, ModelReply } from "../src/types.ts";
import { verifyCriteria } from "../src/verify.ts";
import { runCommand } from "../src/exec.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lucky-"));

class Script implements ModelProvider {
  name = "script";
  private replies: ModelReply[];
  constructor(replies: ModelReply[]) { this.replies = replies; }
  async chat(): Promise<ModelReply> { return this.replies.shift() ?? { content: "fim", toolCalls: [] }; }
}
const writeCall = (p: string, content: string): ModelReply =>
  ({ content: "", toolCalls: [{ id: "1", name: "write_file", args: { path: p, content } }] });

function setup(replies: ModelReply[], mode: Mode, approve: boolean) {
  const workspace = tmp(), home = tmp();
  const audit = new Audit(openDb(home));
  const deps: AgentDeps = {
    provider: new Script(replies), tools: builtinTools, workspace, home, mode, audit,
    gate: new ApprovalGate(async () => approve),
  };
  return { deps, workspace, audit };
}

test("resolveInside bloqueia '..' e symlink para fora", () => {
  const ws = tmp(), outside = tmp();
  assert.throws(() => resolveInside(ws, "../x"), /fora do workspace/);
  assert.throws(() => resolveInside(ws, outside), /fora do workspace/);
  fs.symlinkSync(outside, path.join(ws, "link"));
  assert.throws(() => resolveInside(ws, "link/segredo.txt"), /fora do workspace/);
  assert.doesNotThrow(() => resolveInside(ws, "sub/novo.txt"));
});

test("política de comandos", () => {
  assert.equal(decideCommand("git status").action, "allow");
  assert.equal(decideCommand("rm -rf /").action, "deny");
  assert.equal(decideCommand("git status; rm x").action, "deny");
  assert.equal(decideCommand("npm test").action, "ask");
});

test("aprovação é presa ao hash da ação exata e é de uso único", async () => {
  const gate = new ApprovalGate(async () => true);
  await gate.request("write_file", { path: "a", content: "1" }, "x");
  assert.equal(gate.consume("write_file", { path: "a", content: "2" }), false); // conteúdo mudou
  assert.equal(gate.consume("write_file", { content: "1", path: "a" }), true);  // ordem das chaves irrelevante
  assert.equal(gate.consume("write_file", { path: "a", content: "1" }), false); // uso único
  assert.notEqual(actionHash("t", { a: 1 }), actionHash("t", { a: 2 }));
});

test("auditoria detecta adulteração", () => {
  const home = tmp();
  const db = openDb(home);
  const audit = new Audit(db);
  audit.log("run", "t", "um"); audit.log("run", "t", "dois"); audit.log("run", "t", "três");
  assert.equal(audit.verify().ok, true);
  db.exec("UPDATE audit SET summary='forjado' WHERE id=2");
  const v = audit.verify();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 2);
});

test("escrita aprovada acontece; rejeitada não acontece", async () => {
  const a = setup([writeCall("ok.txt", "oi")], "ask", true);
  await runAgent(a.deps, "x");
  assert.equal(fs.readFileSync(path.join(a.workspace, "ok.txt"), "utf8"), "oi");

  const b = setup([writeCall("no.txt", "oi")], "ask", false);
  const r = await runAgent(b.deps, "x");
  assert.equal(fs.existsSync(path.join(b.workspace, "no.txt")), false);
  assert.equal(r.denied, 1);
});

test("modo plan nega escrita e path traversal é negado", async () => {
  const a = setup([writeCall("p.txt", "oi")], "plan", true);
  const r = await runAgent(a.deps, "x");
  assert.equal(fs.existsSync(path.join(a.workspace, "p.txt")), false);
  assert.equal(r.denied, 1);

  const b = setup([writeCall("../fora.txt", "oi")], "auto", true);
  assert.equal((await runAgent(b.deps, "x")).denied, 1);
});

test("sobrescrever arquivo gera backup recuperável", async () => {
  const a = setup([writeCall("f.txt", "novo")], "auto", true);
  fs.writeFileSync(path.join(a.workspace, "f.txt"), "antigo");
  await runAgent(a.deps, "x");
  const backups = fs.readdirSync(path.join(a.deps.home, "backups"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(a.deps.home, "backups", backups[0]), "utf8"), "antigo");
});

test("missão só passa com critérios verificados por código", async () => {
  const ws = tmp();
  assert.equal((await verifyCriteria([], ws)).ok, false);
  const crit = [{ type: "file_exists" as const, path: "a.txt" }];
  assert.equal((await verifyCriteria(crit, ws)).ok, false);
  fs.writeFileSync(path.join(ws, "a.txt"), "olá mundo");
  assert.equal((await verifyCriteria(crit, ws)).ok, true);
  assert.equal((await verifyCriteria([{ type: "file_contains", path: "a.txt", text: "mundo" }], ws)).ok, true);
  assert.equal((await verifyCriteria([{ type: "command_ok", command: "node --version" }], ws)).ok, true);
});

test("store: missões e memória com nível de confiança", () => {
  const s = new Store(openDb(tmp()));
  const m = s.createMission("meta");
  s.addCriterion(m.id, { type: "file_exists", path: "x" });
  assert.equal(s.getMission(m.id)?.criteria.length, 1);
  s.setStatus(m.id, "COMPLETED", "ok");
  assert.equal(s.getMission(m.id)?.status, "COMPLETED");
  s.remember("inferred", "talvez", "modelo");
  assert.equal(s.listMemory()[0].confidence, "inferred");
});


test("verificador não executa comandos que exigem aprovação", async () => {
  const ws = tmp();
  const r = await verifyCriteria([{ type: "command_ok", command: "npm test" }], ws);
  assert.equal(r.ok, false);
  assert.match(r.report[0], /não solicita nem presume aprovação/);
});

test("fronteira de execução bloqueia comandos não aprovados e metacaracteres", async () => {
  const ws = tmp();
  const ask = await runCommand("npm test", ws);
  assert.notEqual(ask.code, 0);
  assert.match(ask.output, /exige aprovação explícita/);

  const injected = await runCommand("node --version; node --version", ws, 60_000, true);
  assert.notEqual(injected.code, 0);
  assert.match(injected.output, /bloqueado/);

  const safe = await runCommand("node --version", ws);
  assert.equal(safe.code, 0);
});

test("allowlist de comandos é exata, sem argumentos arbitrários", () => {
  assert.equal(decideCommand("git status").action, "allow");
  assert.equal(decideCommand("git status --short").action, "ask");
  assert.equal(decideCommand("node --version").action, "allow");
  assert.equal(decideCommand("node --version; whoami").action, "deny");
});
