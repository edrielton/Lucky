import { test } from "node:test";
import assert from "node:assert/strict";
import { reason, buildPlan, evaluateStrategy } from "../src/intelligence/index.ts";

test("raciocínio simbólico deriva fatos encadeados com proveniência", () => {
  const result = reason(
    [{ subject: "Luna", predicate: "é", object: "mamífero", source: "teste", confidence: 0.9 }],
    [
      { id: "mamifero-animal", when: [{ subject: "?x", predicate: "é", object: "mamífero" }], then: { subject: "?x", predicate: "é", object: "animal" } },
      { id: "animal-ser-vivo", when: [{ subject: "?x", predicate: "é", object: "animal" }], then: { subject: "?x", predicate: "é", object: "ser vivo" } },
    ],
  );
  assert.equal(result.derived.length, 2);
  assert.ok(result.facts.some(f => f.subject === "Luna" && f.object === "ser vivo"));
  assert.deepEqual(result.contradictions, []);
  assert.equal(result.derived[0].derivedBy, "mamifero-animal");
});

test("raciocínio aponta contradições em vez de escolher um fato arbitrariamente", () => {
  const result = reason([
    { subject: "porta", predicate: "estado", object: "aberta", source: "sensor-A", confidence: 0.8 },
    { subject: "porta", predicate: "estado", object: "fechada", source: "sensor-B", confidence: 0.8 },
  ], []);
  assert.equal(result.contradictions.length, 1);
  assert.deepEqual(result.contradictions[0].objects, ["aberta", "fechada"]);
});

test("planejador ordena dependências e detecta ciclos/referências ausentes", () => {
  const plan = buildPlan([
    { id: "c", description: "validar", dependsOn: ["b"] },
    { id: "b", description: "construir", dependsOn: ["a"] },
    { id: "a", description: "planejar" },
  ]);
  assert.equal(plan.valid, true);
  assert.deepEqual(plan.ordered.map(s => s.id), ["a", "b", "c"]);
  assert.equal(buildPlan([{ id: "a", description: "A", dependsOn: ["b"] }, { id: "b", description: "B", dependsOn: ["a"] }]).valid, false);
  assert.equal(buildPlan([{ id: "a", description: "A", dependsOn: ["missing"] }]).valid, false);
});

test("evolution engine exige amostra mínima e nunca promove automaticamente", () => {
  assert.equal(evaluateStrategy({ attempts: 3, successes: 2 }, { attempts: 3, successes: 3 }).decision, "insufficient_evidence");
  const result = evaluateStrategy({ attempts: 20, successes: 10 }, { attempts: 20, successes: 16 });
  assert.equal(result.decision, "candidate_better");
  assert.match(result.reason, /revisão/);
  assert.throws(() => evaluateStrategy({ attempts: 2, successes: 3 }, { attempts: 10, successes: 9 }), /Evidência inválida/);
});
