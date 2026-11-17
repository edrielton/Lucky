import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const h = (s: string) => createHash("sha256").update(s).digest("hex");

/** Log append-only com cadeia de hashes: adulteração é detectável. */
export class Audit {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS audit(
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, kind TEXT, tool TEXT, summary TEXT, prev TEXT, hash TEXT)`);
  }
  log(kind: string, tool: string, summary: string): void {
    const last = this.db.prepare("SELECT hash FROM audit ORDER BY id DESC LIMIT 1").get() as { hash: string } | undefined;
    const prev = last?.hash ?? "genesis";
    const ts = new Date().toISOString();
    const text = summary.slice(0, 500);
    this.db.prepare("INSERT INTO audit(ts,kind,tool,summary,prev,hash) VALUES(?,?,?,?,?,?)")
      .run(ts, kind, tool, text, prev, h([prev, ts, kind, tool, text].join("|")));
  }
  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM audit").get() as { n: number }).n;
  }
  verify(): { ok: boolean; brokenAt?: number } {
    const rows = this.db.prepare("SELECT * FROM audit ORDER BY id").all() as Array<Record<string, string | number>>;
    let prev = "genesis";
    for (const r of rows) {
      const expect = h([prev, r.ts, r.kind, r.tool, r.summary].join("|"));
      if (r.prev !== prev || r.hash !== expect) return { ok: false, brokenAt: Number(r.id) };
      prev = String(r.hash);
    }
    return { ok: true };
  }
}
