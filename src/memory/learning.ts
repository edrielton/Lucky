import { createHash } from "node:crypto";
import type { Store, Experience, LearningInsight } from "../store.ts";

export interface LearningAnalysis {
  examined: number;
  recurringFailures: number;
  insights: LearningInsight[];
}

/**
 * Aprendizagem determinística e auditável. Esta camada identifica recorrências;
 * ela não altera código, políticas, permissões ou objetivos do Lucky.
 */
export class LearningEngine {
  private readonly store: Store;
  constructor(store: Store) { this.store = store; }

  analyze(minOccurrences = 2): LearningAnalysis {
    if (!Number.isInteger(minOccurrences) || minOccurrences < 2 || minOccurrences > 20) {
      throw new Error("minOccurrences deve estar entre 2 e 20.");
    }
    const failures = this.store.listExperiences().filter((item) => item.kind === "error");
    const groups = new Map<string, Experience[]>();
    for (const item of failures) {
      const normalized = normalize(item.result);
      if (!normalized) continue;
      const key = `${item.context}|${item.action}|${normalized}`;
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    }

    const insights: LearningInsight[] = [];
    for (const [key, items] of groups) {
      if (items.length < minOccurrences) continue;
      const fingerprint = createHash("sha256").update(key).digest("hex");
      const insight: LearningInsight = {
        fingerprint,
        category: "recurring_failure",
        summary: `Falha recorrente em ${items[0].context}: ${items[0].result}`,
        occurrences: items.length,
        evidenceIds: items.map((item) => item.id),
        confidence: "observed",
        updated: new Date().toISOString(),
      };
      this.store.saveInsight(insight);
      insights.push(insight);
    }
    return { examined: failures.length, recurringFailures: insights.length, insights };
  }

  listInsights(): LearningInsight[] {
    return this.store.listInsights();
  }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\b\d{2,}\b/g, "#").replace(/\s+/g, " ").trim().slice(0, 300);
}
