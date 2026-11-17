import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { runAgent } from "./agent/loop.ts";
import { openDb } from "./db.ts";
import { ApprovalGate } from "./kernel/approval.ts";
import { Audit } from "./kernel/audit.ts";
import { NullProvider, OllamaProvider, OpenAICompatProvider } from "./model/providers.ts";
import { Store, type Criterion } from "./store.ts";
import { LearningEngine } from "./memory/learning.ts";
import { reason, buildPlan, evaluateStrategy } from "./intelligence/index.ts";
import { inspectSandboxCapability } from "./security/sandbox.ts";
import { builtinTools } from "./tools/builtin.ts";
import type { Mode, ModelProvider } from "./types.ts";
import { verifyCriteria } from "./verify.ts";
import { runSelfTests } from "./testing/runner.ts";
import { runQualityGate } from "./testing/quality.ts";
import { runSupervisedCorrection } from "./development/supervised.ts";
import { requestCorrectionProposal } from "./development/proposal.ts";
import { formatIntegrityReport, verifyReleaseIntegrity } from "./security/integrity.ts";
import { fileURLToPath } from "node:url";

function makeProvider(): ModelProvider {
  const kind = process.env.LUCKY_PROVIDER ?? "none";
  const model = process.env.LUCKY_MODEL ?? "qwen2.5:7b"; // troque conforme seu hardware
  if (kind === "ollama") return new OllamaProvider(process.env.LUCKY_BASE_URL ?? "http://localhost:11434", model);
  if (kind === "openai") return new OpenAICompatProvider(process.env.LUCKY_BASE_URL ?? "http://localhost:8080/v1", model, process.env.LUCKY_API_KEY);
  return new NullProvider();
}

/** Prevent model-proposed control characters from spoofing terminal output. */
function terminalSafe(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function parseCriterion(s: string): Criterion | string {
  if (s.startsWith("existe:")) return { type: "file_exists", path: s.slice(7) };
  if (s.startsWith("contem:")) {
    const [p, ...t] = s.slice(7).split("::");
    return p && t.length ? { type: "file_contains", path: p, text: t.join("::") } : "use contem:<arquivo>::<texto>";
  }
  if (s.startsWith("cmd:")) return { type: "command_ok", command: s.slice(4) };
  return "use existe:<arquivo> | contem:<arquivo>::<texto> | cmd:<comando>";
}

async function main() {
  const releaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const integrity = verifyReleaseIntegrity(releaseRoot);
  if (!integrity.ok) {
    console.error(formatIntegrityReport(integrity));
    process.exitCode = 1;
    return;
  }
  console.log(formatIntegrityReport(integrity));
  const workspace = path.resolve(process.env.LUCKY_WORKSPACE ?? "workspace");
  const home = path.resolve(process.env.LUCKY_HOME ?? path.join(os.homedir(), ".lucky"));
  const mode = (process.env.LUCKY_MODE ?? "ask") as Mode;
  fs.mkdirSync(workspace, { recursive: true });
  if (!path.relative(workspace, home).startsWith("..")) {
    throw new Error("LUCKY_HOME não pode ficar dentro do workspace (o agente alcançaria o próprio kernel).");
  }

  const db = openDb(home);
  const audit = new Audit(db);
  const store = new Store(db);
  const learning = new LearningEngine(store);
  const provider = makeProvider();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const gate = new ApprovalGate(async (summary, hash) => {
    console.log(`\n⚠ APROVAÇÃO NECESSÁRIA [${hash.slice(0, 8)}]\n${summary}`);
    return /^(s|sim|y|yes)$/i.test((await rl.question("Aprovar? (s/N) ")).trim());
  });
  const deps = { provider, tools: builtinTools, workspace, home, mode, gate, audit, store };

  const packageInfo = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")) as { version?: string };
  console.log(`Lucky ${packageInfo.version ?? "versão desconhecida"} — modelo: ${provider.name} · modo: ${mode} · workspace: ${workspace}`);
  console.log("Comandos: status · autoteste · qualidade · autocorrigir · sandbox · inteligencia · tarefas · memória · lembrar <texto> · aprender · capturas · captura <id> · desenvolva <objetivo> · criterio <id> <crit> · execute missão <id> · concluir <id> · sair");

  for (;;) {
    const line = (await rl.question("\nlucky> ")).trim().replace(/^lucky,?\s*/i, "");
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(" ");
    try {
      if (!line) continue;
      if (cmd === "sair") break;
      else if (cmd === "autoteste") {
        const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
        const r = await runSelfTests(projectRoot);
        audit.log("selftest", "core", `${r.ok ? "PASS" : "FAIL"}; exit=${r.exitCode}; durationMs=${r.durationMs}; files=${r.testFiles.length}`);
        console.log(r.report);
        console.log("\n--- saída dos testes ---\n" + (r.output || "(sem saída)"));
      } else if (cmd === "qualidade" || cmd === "qa") {
        const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
        const r = await runQualityGate(projectRoot);
        for (const check of r.checks) audit.log("quality_gate", check.name, `${check.status}: ${check.detail.slice(0, 1000)}`);
        console.log(r.report);
        if (!r.ok) console.log("\nPortão reprovado: corrija as falhas antes de considerar a versão validada.");
      } else if (cmd === "autocorrigir") {
        const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
        console.log("Autocorreção supervisionada: o Lucky criará uma cópia temporária e executará testes em contêiner Docker isolado.");
        console.log("O contêiner não terá rede, terá filesystem-base somente leitura e cotas de CPU, RAM e processos. Sem Docker/imagem local, a execução será recusada.");
        console.log("Se houver falhas, o modelo poderá propor um patch. Nenhuma alteração será copiada ao projeto original ou publicada.");
        const r = await runSupervisedCorrection({
          projectRoot,
          maxAttempts: 3,
          propose: async (context) => {
            if (provider instanceof NullProvider) {
              console.log("Nenhum modelo está configurado. Para gerar propostas sem API remota, configure um modelo local compatível (por exemplo, Ollama ou LM Studio) e tente novamente.");
              return null;
            }
            return requestCorrectionProposal(provider, context);
          },
          authorizeExecution: async ({ attempt, summary, changes, sandboxPath, proposalHash }) => {
            console.log(`\nPROPOSTA ${attempt}: ${terminalSafe(summary)}`);
            console.log(`Sandbox: ${sandboxPath}`);
            console.log(`Arquivos propostos: ${changes.length}`);
            for (const change of changes) {
              console.log(`\n===== ${terminalSafe(change.path)} =====\n${terminalSafe(change.content)}`);
            }
            console.log("\nISOLAMENTO: os testes serão executados no contêiner Docker sem rede, com filesystem-base somente leitura e cotas de recursos.");
            console.log(`Hash SHA-256 da proposta: ${proposalHash}`);
            return (await rl.question(`Para autorizar exatamente esta proposta, digite EXECUTAR ${proposalHash.slice(0, 12)}: `)).trim() === `EXECUTAR ${proposalHash.slice(0, 12)}`;
          },
          approveReview: async ({ summary, sandboxPath, testReport, attempts, proposalHash }) => {
            console.log(`\nCorreção validada após ${attempts} tentativa(s): ${summary}`);
            console.log(testReport.report);
            console.log(`Cópia para revisão manual: ${sandboxPath}`);
            console.log(`Hash SHA-256 revisado: ${proposalHash}`);
            console.log("Esta aprovação não promove arquivos nem altera o projeto original.");
            return (await rl.question(`Para aprovar esta versão exata para revisão manual, digite APROVAR ${proposalHash.slice(0, 12)}: `)).trim() === `APROVAR ${proposalHash.slice(0, 12)}`;
          },
        });
        audit.log("supervised_correction", "core", `${r.status}; attempts=${r.attempts}; tests=${r.tests.ok ? "PASS" : "FAIL"}; proposalHash=${r.proposalHash ?? "none"}; sandbox=${r.sandboxPath}`);
        console.log(`\nEstado: ${r.status}\n${r.report}\nSandbox preservada para inspeção: ${r.sandboxPath}`);
        console.log("\n--- relatório dos testes ---\n" + r.tests.report);
        if (r.tests.output) console.log("\n--- saída dos testes ---\n" + r.tests.output);
      } else if (cmd === "inteligencia" || cmd === "inteligência") {
        const reasoning = reason(
          [{ subject: "Lucky", predicate: "possui", object: "memória estruturada", source: "demonstração interna", confidence: 1 }],
          [{ id: "memoria-e-conhecimento", when: [{ subject: "?sistema", predicate: "possui", object: "memória estruturada" }], then: { subject: "?sistema", predicate: "pode armazenar", object: "experiências" } }],
        );
        const plan = buildPlan([
          { id: "planejar", description: "Definir objetivo" },
          { id: "executar", description: "Executar tarefa", dependsOn: ["planejar"] },
          { id: "verificar", description: "Verificar resultado", dependsOn: ["executar"] },
        ]);
        const evolution = evaluateStrategy({ attempts: 20, successes: 12 }, { attempts: 20, successes: 16 });
        audit.log("intelligence_diagnostic", "intelligence", `derived=${reasoning.derived.length}; plan=${plan.valid}; strategy=${evolution.decision}`);
        console.log("INTELIGÊNCIA EVOLUTIVA — diagnóstico local");
        console.log(`Raciocínio simbólico: ${reasoning.derived.length} inferência(s) demonstrada(s)`);
        console.log(`Planejamento por dependências: ${plan.valid ? plan.ordered.map(step => step.id).join(" → ") : "falhou"}`);
        console.log(`Avaliação de estratégia: ${evolution.decision} (${(evolution.delta! * 100).toFixed(1)} pontos percentuais)`);
        console.log("Aprendizagem operacional: use aprender para analisar experiências registradas.");
        console.log("Limites: diagnóstico demonstrativo; não representa compreensão geral, consciência ou aprendizagem autônoma de código.");
        console.log("Linguagem natural aberta e conselho multiagente ainda não estão implementados sem um provedor externo.");
      } else if (cmd === "status") {
        const v = audit.verify();
        console.log(`modelo: ${provider.name}\nmodo: ${mode}\nmissões: ${store.listMissions().length}\nmemórias: ${store.listStructuredMemory().length}\nexperiências: ${store.listExperiences().length}\nauditoria: ${audit.count()} registros · integridade: ${v.ok ? "OK" : `QUEBRADA no registro ${v.brokenAt}`}`);
      } else if (cmd === "tarefas") {
        for (const m of store.listMissions()) console.log(`[${m.id}] ${m.status.padEnd(17)} ${m.goal} (${m.criteria.length} critérios)${m.result ? "\n   → " + m.result : ""}`);
      } else if (cmd === "memória" || cmd === "memoria") {
        const memories = store.listStructuredMemory();
        if (!memories.length) console.log("Nenhuma memória estruturada registrada.");
        for (const r of memories) console.log(`[${r.kind}/${r.confidence}] ${r.content} (fonte: ${r.source}; tags: ${r.tags.join(", ") || "nenhuma"})`);
        console.log(`Experiências registradas: ${store.listExperiences().length}`);
      } else if (cmd === "aprender") {
        const analysis = learning.analyze();
        audit.log("learning_analysis", "learning", `examined=${analysis.examined}; recurring=${analysis.recurringFailures}`);
        console.log(`Experiências de erro examinadas: ${analysis.examined}`);
        console.log(`Padrões recorrentes identificados: ${analysis.recurringFailures}`);
        const insights = learning.listInsights();
        if (!insights.length) console.log("Ainda não há falhas repetidas suficientes para inferir um padrão.");
        for (const insight of insights) console.log(`\n[${insight.confidence}] ${insight.summary}\nOcorrências: ${insight.occurrences} · evidências: ${insight.evidenceIds.length}`);
        console.log("A aprendizagem gera observações auditáveis; não altera código, objetivos ou permissões automaticamente.");
      } else if (cmd === "sandbox") {
        const capability = inspectSandboxCapability();
        console.log(`Backend: ${capability.backend}\nDisponível: ${capability.available ? "sim" : "não"}\nImagem: ${capability.image}\nDetalhe: ${capability.reason}`);
        console.log("Sem backend de isolamento disponível, o ciclo de autocorreção recusará executar código experimental.");
      } else if (cmd === "capturas") {
        const inbox = path.join(home, "inbox");
        fs.mkdirSync(inbox, { recursive: true });
        const files = fs.readdirSync(inbox).filter((f) => /^\d+-[a-f0-9]+\.json$/.test(f)).sort().reverse();
        if (!files.length) console.log("Nenhuma página recebida da extensão.");
        for (const file of files.slice(0, 50)) {
          try { const c = JSON.parse(fs.readFileSync(path.join(inbox, file), "utf8")); console.log(`[${c.id}] ${c.title} — ${c.url}`); }
          catch { console.log(`[inválida] ${file}`); }
        }
      } else if (cmd === "captura") {
        if (!/^[0-9]+-[a-f0-9]+$/.test(arg)) { console.log("Use captura <id> conforme a lista de capturas."); continue; }
        const file = path.join(home, "inbox", `${arg}.json`);
        if (!fs.existsSync(file)) { console.log("Captura não encontrada."); continue; }
        const c = JSON.parse(fs.readFileSync(file, "utf8"));
        console.log(`${c.title}\n${c.url}\nRecebida em: ${c.receivedAt}\n\n${c.text}`);
      } else if (cmd === "lembrar") {
        store.remember("confirmed", arg, "usuário");
        audit.log("memory", "user", `memória confirmada (${arg.length} caracteres)`);
        console.log("ok");
      } else if (cmd === "desenvolva") {
        const m = store.createMission(arg);
        audit.log("mission", "-", `criada ${m.id}: ${arg}`);
        console.log(`Missão ${m.id} criada. Defina critérios verificáveis (criterio ${m.id} ...) e rode: execute missão ${m.id}`);
      } else if (cmd === "criterio") {
        const [id, ...c] = rest;
        const parsed = parseCriterion(c.join(" "));
        if (typeof parsed === "string") console.log(parsed);
        else { store.addCriterion(id, parsed); audit.log("criterion", "-", `${id}: ${c.join(" ")}`); console.log("critério adicionado"); }
      } else if (cmd === "execute") {
        const m = store.getMission(rest[1] ?? "");
        if (!m) { console.log("missão não encontrada"); continue; }
        store.setStatus(m.id, "RUNNING");
        try {
          const r = await runAgent(deps, m.goal);
          console.log(`\n${r.text}\n(passos: ${r.steps}, ações negadas: ${r.denied})`);
        } catch (e) {
          store.setStatus(m.id, "BLOCKED", (e as Error).message);
          console.log(`BLOCKED: ${(e as Error).message}`);
          continue;
        }
        const v = await verifyCriteria(m.criteria, workspace);
        console.log(v.report.join("\n"));
        if (!m.criteria.length) store.setStatus(m.id, "AWAITING_APPROVAL", "sem critérios automáticos: revisão humana necessária");
        else store.setStatus(m.id, v.ok ? "COMPLETED" : "FAILED", v.ok ? "todos os critérios verificados" : "critérios falharam");
        store.recordExperience({ kind: v.ok && m.criteria.length ? "outcome" : "observation", context: "mission", action: v.ok ? "criteria_passed" : "criteria_pending_or_failed", result: `${m.id}: ${v.report.join("; ").slice(0, 700)}` });
      } else if (cmd === "concluir") {
        store.setStatus(arg, "COMPLETED", "concluída manualmente pelo usuário");
        audit.log("manual_complete", "-", arg);
      } else console.log("comando desconhecido");
    } catch (e) {
      console.log(`erro: ${(e as Error).message}`);
    }
  }
  rl.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
