/** Motor simbólico determinístico. Não usa LLM nem executa ações. */
export interface Fact {
  subject: string;
  predicate: string;
  object: string;
  source: string;
  confidence: number;
}

export interface Rule {
  id: string;
  when: Array<Pick<Fact, "subject" | "predicate" | "object">>;
  then: Pick<Fact, "subject" | "predicate" | "object">;
}

export interface DerivedFact extends Fact {
  derivedBy: string;
  premises: number[];
}

export interface ReasoningResult {
  facts: Fact[];
  derived: DerivedFact[];
  contradictions: Array<{ subject: string; predicate: string; objects: string[] }>;
  rounds: number;
  truncated: boolean;
}

const normalize = (value: string): string => value.trim().toLocaleLowerCase("pt-BR");
const validTerm = (value: string): boolean => typeof value === "string" && value.trim().length > 0 && value.length <= 200;

/** Variáveis de regra começam com ?. A inferência para ao atingir limite de rodadas/fatos. */
export function reason(facts: Fact[], rules: Rule[], limits: { maxRounds?: number; maxFacts?: number; exclusivePredicates?: string[] } = {}): ReasoningResult {
  const maxRounds = limits.maxRounds ?? 8;
  const maxFacts = limits.maxFacts ?? 500;
  const exclusivePredicates = new Set((limits.exclusivePredicates ?? ["estado", "status", "situação", "situacao"]).map(normalize));
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 50) throw new Error("maxRounds deve estar entre 1 e 50.");
  if (!Number.isInteger(maxFacts) || maxFacts < 1 || maxFacts > 10_000) throw new Error("maxFacts deve estar entre 1 e 10000.");
  for (const fact of facts) {
    if (![fact.subject, fact.predicate, fact.object, fact.source].every(validTerm) || !Number.isFinite(fact.confidence) || fact.confidence < 0 || fact.confidence > 1) {
      throw new Error("Fato inválido: termos obrigatórios e confiança entre 0 e 1.");
    }
  }
  for (const rule of rules) {
    if (!validTerm(rule.id) || !rule.when.length || rule.when.length > 10 || ![rule.then.subject, rule.then.predicate, rule.then.object, ...rule.when.flatMap(x => [x.subject, x.predicate, x.object])].every(validTerm)) {
      throw new Error("Regra inválida.");
    }
  }

  const all: Fact[] = facts.map(f => ({ ...f }));
  const derived: DerivedFact[] = [];
  let rounds = 0;
  let changed = true;
  while (changed && rounds < maxRounds && all.length < maxFacts) {
    changed = false;
    rounds++;
    for (const rule of rules) {
      const matches = matchPremises(rule.when, all);
      for (const match of matches) {
        const conclusion = {
          subject: resolve(rule.then.subject, match.bindings),
          predicate: resolve(rule.then.predicate, match.bindings),
          object: resolve(rule.then.object, match.bindings),
        };
        if (!validTerm(conclusion.subject) || !validTerm(conclusion.predicate) || !validTerm(conclusion.object)) continue;
        if (all.some(f => sameFact(f, conclusion))) continue;
        const confidence = Math.min(...match.indices.map(i => all[i].confidence));
        const item: DerivedFact = { ...conclusion, source: `rule:${rule.id}`, confidence, derivedBy: rule.id, premises: match.indices };
        all.push(item);
        derived.push(item);
        changed = true;
        if (all.length >= maxFacts) break;
      }
      if (all.length >= maxFacts) break;
    }
  }

  const groups = new Map<string, Set<string>>();
  for (const fact of all) {
    const key = `${normalize(fact.subject)}\u0000${normalize(fact.predicate)}`;
    const values = groups.get(key) ?? new Set<string>();
    values.add(normalize(fact.object));
    groups.set(key, values);
  }
  const contradictions = [...groups.entries()]
    .filter(([key, objects]) => objects.size > 1 && exclusivePredicates.has(key.split("\u0000")[1]))
    .map(([key, objects]) => {
      const [subject, predicate] = key.split("\u0000");
      return { subject, predicate, objects: [...objects].sort() };
    });
  return { facts: all, derived, contradictions, rounds, truncated: all.length >= maxFacts || (changed && rounds >= maxRounds) };
}

function matchPremises(patterns: Rule["when"], facts: Fact[]): Array<{ bindings: Map<string, string>; indices: number[] }> {
  let states: Array<{ bindings: Map<string, string>; indices: number[] }> = [{ bindings: new Map(), indices: [] }];
  for (const pattern of patterns) {
    const next: typeof states = [];
    for (const state of states) {
      facts.forEach((fact, index) => {
        const bindings = new Map(state.bindings);
        if (bind(pattern.subject, fact.subject, bindings) && bind(pattern.predicate, fact.predicate, bindings) && bind(pattern.object, fact.object, bindings)) {
          next.push({ bindings, indices: [...state.indices, index] });
        }
      });
    }
    states = next;
    if (!states.length) break;
  }
  return states;
}
function bind(pattern: string, value: string, bindings: Map<string, string>): boolean {
  if (!pattern.startsWith("?")) return normalize(pattern) === normalize(value);
  const previous = bindings.get(pattern);
  if (previous !== undefined) return normalize(previous) === normalize(value);
  bindings.set(pattern, value);
  return true;
}
function resolve(term: string, bindings: Map<string, string>): string { return term.startsWith("?") ? bindings.get(term) ?? "" : term; }
function sameFact(a: Pick<Fact, "subject" | "predicate" | "object">, b: Pick<Fact, "subject" | "predicate" | "object">): boolean {
  return normalize(a.subject) === normalize(b.subject) && normalize(a.predicate) === normalize(b.predicate) && normalize(a.object) === normalize(b.object);
}
