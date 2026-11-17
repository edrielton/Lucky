import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectProjectContext, parseCorrectionProposal, requestCorrectionProposal } from "../src/development/proposal.ts";
import type { ModelProvider } from "../src/types.ts";

 test("parser aceita proposta JSON estrita e JSON cercado por markdown", () => {
  const json = JSON.stringify({ summary: "corrigir bug", changes: [{ path: "src/fix.ts", content: "export const fixed = true;\n" }] });
  assert.deepEqual(parseCorrectionProposal(json), { summary: "corrigir bug", changes: [{ path: "src/fix.ts", content: "export const fixed = true;\n" }] });
  assert.deepEqual(parseCorrectionProposal(`\`\`\`json\n${json}\n\`\`\``), { summary: "corrigir bug", changes: [{ path: "src/fix.ts", content: "export const fixed = true;\n" }] });
});

test("parser rejeita JSON inválido, alterações vazias, duplicadas ou excessivas", () => {
  assert.equal(parseCorrectionProposal("não é JSON"), null);
  assert.equal(parseCorrectionProposal(JSON.stringify({ summary: "", changes: [{ path: "a.ts", content: "x" }] })), null);
  assert.equal(parseCorrectionProposal(JSON.stringify({ summary: "duplicado", changes: [{ path: "a.ts", content: "x" }, { path: "a.ts", content: "y" }] })), null);
  assert.equal(parseCorrectionProposal(JSON.stringify({ summary: "vazio", changes: [] })), null);
  assert.equal(parseCorrectionProposal(JSON.stringify({ summary: "grande", changes: [{ path: "large.ts", content: "x".repeat(130_000) }] })), null);
});

test("contexto de projeto coleta fontes permitidas sem seguir symlinks ou incluir env", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-proposal-context-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "lucky" }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "main.ts"), "export const x = 1;\n");
  fs.writeFileSync(path.join(root, ".env.secret"), "DO_NOT_INCLUDE=secret\n");
  const context = collectProjectContext(root);
  assert.match(context, /FILE src\/main\.ts/);
  assert.doesNotMatch(context, /DO_NOT_INCLUDE|secret/);
});

test("solicitação ao modelo inclui contexto de código e valida resposta antes de devolvê-la", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-proposal-request-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "lucky" }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "main.ts"), "export const target = 1;\n");
  let prompt = "";
  const provider: ModelProvider = {
    name: "mock-local",
    async chat(messages, tools) {
      assert.equal(tools.length, 0);
      prompt = messages.map((message) => message.content).join("\n");
      return { content: JSON.stringify({ summary: "corrigir regressão", changes: [{ path: "src/main.ts", content: "export const target = 2;\n" }] }), toolCalls: [] };
    },
  };
  const proposal = await requestCorrectionProposal(provider, {
    attempt: 1,
    sandboxPath: root,
    previousReport: { report: "Um teste falhou", output: "assertion failed", testFiles: ["test/main.test.ts"] },
  });
  assert.equal(proposal?.summary, "corrigir regressão");
  assert.match(prompt, /FILE src\/main\.ts/);
  assert.match(prompt, /assertion failed/);
});
