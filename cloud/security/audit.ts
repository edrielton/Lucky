import type { D1Database } from "../types.ts";
import { sha256 } from "../auth/password.ts";

const GENESIS = "genesis";

export interface AuditEntry {
  sequence: number;
  created_at: string;
  kind: string;
  subject: string;
  summary: string;
  previous_hash: string;
  hash: string;
}

export async function appendAudit(db: D1Database, userId: string, kind: string, subject: string, summary: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const head = await db.prepare("SELECT sequence,hash FROM audit_heads WHERE user_id=?").bind(userId)
      .first<{ sequence: number; hash: string }>();
    const sequence = (head?.sequence ?? 0) + 1;
    const previousHash = head?.hash ?? GENESIS;
    const createdAt = new Date().toISOString();
    const clippedSummary = summary.slice(0, 1000);
    const hash = await sha256(JSON.stringify([userId, sequence, createdAt, kind, subject, clippedSummary, previousHash]));
    try {
      await db.batch([
        db.prepare(
        `INSERT INTO audit_log(user_id,sequence,created_at,kind,subject,summary,previous_hash,hash)
         VALUES(?,?,?,?,?,?,?,?)`,
        ).bind(userId, sequence, createdAt, kind, subject.slice(0, 160), clippedSummary, previousHash, hash),
        db.prepare(
        `INSERT INTO audit_heads(user_id,sequence,hash) VALUES(?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET sequence=excluded.sequence,hash=excluded.hash
         WHERE audit_heads.sequence < excluded.sequence`,
        ).bind(userId, sequence, hash),
      ]);
      return;
    } catch (error) {
      if (!(error instanceof Error) || !/unique|constraint/iu.test(error.message)) throw error;
      if (attempt === 7) throw error;
    }
  }
  throw new Error("Não foi possível acrescentar o registro de auditoria.");
}

export async function verifyAudit(db: D1Database, userId: string): Promise<{ ok: boolean; count: number; brokenAt?: number }> {
  const result = await db.prepare(
    "SELECT sequence,created_at,kind,subject,summary,previous_hash,hash FROM audit_log WHERE user_id=? ORDER BY sequence",
  ).bind(userId).all<AuditEntry>();
  const entries = result.results ?? [];
  let previous = GENESIS;
  let expectedSequence = 1;
  for (const row of entries) {
    const expected = await sha256(JSON.stringify([
      userId, row.sequence, row.created_at, row.kind, row.subject, row.summary, previous,
    ]));
    if (row.sequence !== expectedSequence || row.previous_hash !== previous || row.hash !== expected) {
      return { ok: false, count: entries.length, brokenAt: row.sequence };
    }
    previous = row.hash;
    expectedSequence++;
  }
  const head = await db.prepare("SELECT sequence,hash FROM audit_heads WHERE user_id=?").bind(userId)
    .first<{ sequence: number; hash: string }>();
  const lastSequence = expectedSequence - 1;
  if ((entries.length === 0 && head) ||
      (entries.length > 0 && (!head || head.sequence !== lastSequence || head.hash !== previous))) {
    return { ok: false, count: entries.length, brokenAt: Math.max(lastSequence, head?.sequence ?? 0) };
  }
  return { ok: true, count: entries.length };
}
