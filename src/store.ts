import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type Status = "PENDING" | "RUNNING" | "BLOCKED" | "AWAITING_APPROVAL" | "COMPLETED" | "FAILED" | "CANCELLED";
export type Criterion =
  | { type: "file_exists"; path: string }
  | { type: "file_contains"; path: string; text: string }
  | { type: "command_ok"; command: string };
export interface Mission { id: string; goal: string; status: Status; criteria: Criterion[]; result: string; created: string }
export type Confidence = "observed" | "inferred" | "confirmed";
export type MemoryKind = "working" | "episodic" | "semantic" | "procedural" | "preference" | "project" | "research" | "system";
export type ExperienceKind = "observation" | "error" | "solution" | "outcome";
export interface MemoryItem { id: string; kind: MemoryKind; content: string; confidence: Confidence; source: string; tags: string[]; metadata: Record<string, unknown>; created: string }
export interface Experience { id: string; kind: ExperienceKind; context: string; action: string; result: string; confidence: Confidence; created: string }
export interface LearningInsight { fingerprint: string; category: string; summary: string; occurrences: number; evidenceIds: string[]; confidence: Confidence; updated: string }

export class Store {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS missions(
      id TEXT PRIMARY KEY, goal TEXT, status TEXT, criteria TEXT, result TEXT, created TEXT);
      CREATE TABLE IF NOT EXISTS memory(
      id INTEGER PRIMARY KEY AUTOINCREMENT, confidence TEXT, text TEXT, source TEXT, created TEXT);
      CREATE TABLE IF NOT EXISTS memory_items(
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, content TEXT NOT NULL, confidence TEXT NOT NULL,
      source TEXT NOT NULL, tags TEXT NOT NULL, metadata TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS experiences(
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, context TEXT NOT NULL, action TEXT NOT NULL,
      result TEXT NOT NULL, confidence TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS learning_insights(
      fingerprint TEXT PRIMARY KEY, category TEXT NOT NULL, summary TEXT NOT NULL,
      occurrences INTEGER NOT NULL, evidence_ids TEXT NOT NULL, confidence TEXT NOT NULL, updated TEXT NOT NULL);
      INSERT OR IGNORE INTO memory_items(id,kind,content,confidence,source,tags,metadata,created)
      SELECT 'legacy-' || id, 'semantic', text, confidence, source, '[]', '{"migrated":true}', created FROM memory;`);
  }
  createMission(goal: string): Mission {
    const m: Mission = { id: randomUUID().slice(0, 8), goal, status: "PENDING", criteria: [], result: "", created: new Date().toISOString() };
    this.db.prepare("INSERT INTO missions VALUES(?,?,?,?,?,?)").run(m.id, m.goal, m.status, "[]", "", m.created);
    return m;
  }
  getMission(id: string): Mission | undefined {
    const r = this.db.prepare("SELECT * FROM missions WHERE id=?").get(id) as Record<string, string> | undefined;
    return r && { id: r.id, goal: r.goal, status: r.status as Status, criteria: JSON.parse(r.criteria), result: r.result, created: r.created };
  }
  listMissions(): Mission[] {
    const ids = this.db.prepare("SELECT id FROM missions ORDER BY created").all() as Array<{ id: string }>;
    return ids.map((r) => this.getMission(r.id)!);
  }
  setStatus(id: string, status: Status, result = ""): void {
    this.db.prepare("UPDATE missions SET status=?, result=? WHERE id=?").run(status, result, id);
  }
  addCriterion(id: string, c: Criterion): void {
    const m = this.getMission(id);
    if (!m) throw new Error("Missão não encontrada");
    this.db.prepare("UPDATE missions SET criteria=? WHERE id=?").run(JSON.stringify([...m.criteria, c]), id);
  }
  remember(confidence: Confidence, text: string, source: string): void {
    const created = new Date().toISOString();
    this.db.prepare("INSERT INTO memory(confidence,text,source,created) VALUES(?,?,?,?)")
      .run(confidence, text, source, created);
    this.addMemory({ kind: "semantic", content: text, confidence, source });
  }
  addMemory(input: { kind: MemoryKind; content: string; confidence: Confidence; source: string; tags?: string[]; metadata?: Record<string, unknown> }): MemoryItem {
    if (!input.content.trim() || !input.source.trim()) throw new Error("Memória exige conteúdo e fonte.");
    const item: MemoryItem = {
      id: randomUUID(), kind: input.kind, content: input.content.slice(0, 20_000), confidence: input.confidence,
      source: input.source.slice(0, 200), tags: (input.tags ?? []).slice(0, 30).map((tag) => tag.slice(0, 80)),
      metadata: input.metadata ?? {}, created: new Date().toISOString(),
    };
    this.db.prepare("INSERT INTO memory_items VALUES(?,?,?,?,?,?,?,?)")
      .run(item.id, item.kind, item.content, item.confidence, item.source, JSON.stringify(item.tags), JSON.stringify(item.metadata), item.created);
    return item;
  }
  listStructuredMemory(limit = 100): MemoryItem[] {
    const rows = this.db.prepare("SELECT * FROM memory_items ORDER BY created DESC LIMIT ?").all(Math.max(1, Math.min(500, limit))) as Array<Record<string, string>>;
    return rows.map((r) => ({ id: r.id, kind: r.kind as MemoryKind, content: r.content, confidence: r.confidence as Confidence, source: r.source, tags: JSON.parse(r.tags), metadata: JSON.parse(r.metadata), created: r.created }));
  }
  recordExperience(input: { kind: ExperienceKind; context: string; action: string; result: string; confidence?: Confidence }): Experience {
    const item: Experience = { id: randomUUID(), kind: input.kind, context: input.context.slice(0, 300), action: input.action.slice(0, 300), result: input.result.slice(0, 1000), confidence: input.confidence ?? "observed", created: new Date().toISOString() };
    this.db.prepare("INSERT INTO experiences VALUES(?,?,?,?,?,?,?)").run(item.id, item.kind, item.context, item.action, item.result, item.confidence, item.created);
    return item;
  }
  listExperiences(limit = 500): Experience[] {
    const rows = this.db.prepare("SELECT * FROM experiences ORDER BY created DESC LIMIT ?").all(Math.max(1, Math.min(2000, limit))) as Array<Record<string, string>>;
    return rows.map((r) => ({ id: r.id, kind: r.kind as ExperienceKind, context: r.context, action: r.action, result: r.result, confidence: r.confidence as Confidence, created: r.created }));
  }
  saveInsight(insight: LearningInsight): void {
    this.db.prepare(`INSERT INTO learning_insights VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(fingerprint) DO UPDATE SET summary=excluded.summary, occurrences=excluded.occurrences,
      evidence_ids=excluded.evidence_ids, confidence=excluded.confidence, updated=excluded.updated`)
      .run(insight.fingerprint, insight.category, insight.summary, insight.occurrences, JSON.stringify(insight.evidenceIds), insight.confidence, insight.updated);
  }
  listInsights(): LearningInsight[] {
    const rows = this.db.prepare("SELECT * FROM learning_insights ORDER BY occurrences DESC, updated DESC").all() as Array<Record<string, string | number>>;
    return rows.map((r) => ({ fingerprint: String(r.fingerprint), category: String(r.category), summary: String(r.summary), occurrences: Number(r.occurrences), evidenceIds: JSON.parse(String(r.evidence_ids)), confidence: String(r.confidence) as Confidence, updated: String(r.updated) }));
  }
  listMemory(): Array<{ confidence: string; text: string; source: string; created: string }> {
    return this.db.prepare("SELECT confidence,text,source,created FROM memory ORDER BY id").all() as never;
  }
}
