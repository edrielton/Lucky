/** Planejador de dependências: ordena etapas sem executar nenhuma delas. */
export interface PlanStep { id: string; description: string; dependsOn?: string[] }
export interface PlanResult { ordered: PlanStep[]; unresolved: string[]; valid: boolean }

export function buildPlan(steps: PlanStep[]): PlanResult {
  const byId = new Map<string, PlanStep>();
  for (const step of steps) {
    if (!step.id.trim() || !step.description.trim() || byId.has(step.id)) throw new Error("Etapas precisam de IDs únicos e descrições não vazias.");
    byId.set(step.id, { ...step, dependsOn: [...new Set(step.dependsOn ?? [])] });
  }
  const unresolved = steps.flatMap(step => (step.dependsOn ?? []).filter(id => !byId.has(id)).map(id => `${step.id}->${id}`));
  if (unresolved.length) return { ordered: [], unresolved, valid: false };

  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const step of byId.values()) {
    indegree.set(step.id, step.dependsOn!.length);
    for (const dependency of step.dependsOn!) {
      const list = dependents.get(dependency) ?? [];
      list.push(step.id);
      dependents.set(dependency, list);
    }
  }
  const ready = [...byId.keys()].filter(id => indegree.get(id) === 0).sort();
  const ordered: PlanStep[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    ordered.push(byId.get(id)!);
    for (const next of (dependents.get(id) ?? []).sort()) {
      const count = indegree.get(next)! - 1;
      indegree.set(next, count);
      if (count === 0) { ready.push(next); ready.sort(); }
    }
  }
  if (ordered.length !== steps.length) return { ordered, unresolved: [...byId.keys()].filter(id => !ordered.some(step => step.id === id)), valid: false };
  return { ordered, unresolved: [], valid: true };
}
