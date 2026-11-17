/** Avalia estratégias com evidências; nunca altera automaticamente o comportamento do agente. */
export interface StrategyEvidence { attempts: number; successes: number }
export interface StrategyEvaluation {
  decision: "insufficient_evidence" | "candidate_better" | "candidate_not_better";
  baselineRate: number | null;
  candidateRate: number | null;
  delta: number | null;
  reason: string;
}

export function evaluateStrategy(baseline: StrategyEvidence, candidate: StrategyEvidence, options: { minAttempts?: number; minimumImprovement?: number } = {}): StrategyEvaluation {
  const minAttempts = options.minAttempts ?? 10;
  const minimumImprovement = options.minimumImprovement ?? 0.05;
  validateEvidence(baseline);
  validateEvidence(candidate);
  if (!Number.isInteger(minAttempts) || minAttempts < 1 || minAttempts > 100_000) throw new Error("minAttempts inválido.");
  if (!Number.isFinite(minimumImprovement) || minimumImprovement < 0 || minimumImprovement > 1) throw new Error("minimumImprovement deve estar entre 0 e 1.");
  if (baseline.attempts < minAttempts || candidate.attempts < minAttempts) {
    return { decision: "insufficient_evidence", baselineRate: rate(baseline), candidateRate: rate(candidate), delta: null, reason: `São necessárias pelo menos ${minAttempts} tentativas em cada estratégia.` };
  }
  const baselineRate = rate(baseline)!;
  const candidateRate = rate(candidate)!;
  const delta = candidateRate - baselineRate;
  if (delta >= minimumImprovement) return { decision: "candidate_better", baselineRate, candidateRate, delta, reason: "A candidata superou o ganho mínimo definido; ainda exige revisão antes de adoção." };
  return { decision: "candidate_not_better", baselineRate, candidateRate, delta, reason: "A candidata não demonstrou melhoria suficiente; mantenha a estratégia atual." };
}
function validateEvidence(value: StrategyEvidence): void {
  if (!Number.isInteger(value.attempts) || value.attempts < 0 || !Number.isInteger(value.successes) || value.successes < 0 || value.successes > value.attempts) throw new Error("Evidência inválida: sucessos devem estar entre zero e tentativas.");
}
function rate(value: StrategyEvidence): number | null { return value.attempts ? value.successes / value.attempts : null; }
