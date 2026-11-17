import type { D1Database } from "../types.ts";
import { sha256 } from "../auth/password.ts";
import { appendAudit } from "./audit.ts";

export interface ApprovalInput {
  tool: string;
  arguments: Record<string, unknown>;
  context: string;
}

export async function approvalHash(userId: string, input: ApprovalInput): Promise<string> {
  return sha256(JSON.stringify([userId, input.tool, canonical(input.arguments), input.context]));
}

export async function createApproval(db: D1Database, userId: string, input: ApprovalInput): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  await db.prepare(
    `INSERT INTO approvals(id,user_id,tool,arguments_json,context,action_hash,status,expires_at,created_at)
     VALUES(?,?,?,?,?,?,'pending',?,?)`,
  ).bind(
    id, userId, input.tool, JSON.stringify(input.arguments), input.context,
    await approvalHash(userId, input), expires, now.toISOString(),
  ).run();
  await appendAudit(db, userId, "approval_requested", input.tool, `Solicitação de aprovação ${id}`);
  return id;
}

export async function decideApproval(db: D1Database, userId: string, id: string, decision: "approved" | "rejected"): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE approvals SET status=?,decided_at=?
     WHERE id=? AND user_id=? AND status='pending' AND expires_at>?`,
  ).bind(decision, now, id, userId, now).run();
  if ((result.meta?.changes ?? 0) !== 1) return false;
  await appendAudit(db, userId, `approval_${decision}`, id, `Aprovação ${decision}`);
  return true;
}

export async function consumeApproval(db: D1Database, userId: string, id: string, input: ApprovalInput): Promise<boolean> {
  const matchingHash = await approvalHash(userId, input);
  const now = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE approvals SET status='consumed',consumed_at=?
     WHERE id=? AND user_id=? AND action_hash=? AND status='approved' AND expires_at>?`,
  ).bind(now, id, userId, matchingHash, now).run();
  if ((result.meta?.changes ?? 0) !== 1) return false;
  await appendAudit(db, userId, "approval_consumed", input.tool, `Aprovação consumida ${id}`);
  return true;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}
