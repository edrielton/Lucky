import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import worker from "../worker.ts";
import type { D1Database, D1PreparedStatement, D1Result, Env } from "../types.ts";
import { consumeApproval } from "../security/approval.ts";
import { verifyAudit } from "../security/audit.ts";

class SqliteStatement implements D1PreparedStatement {
  private values: SQLInputValue[] = [];
  private readonly statement: ReturnType<DatabaseSync["prepare"]>;
  constructor(statement: ReturnType<DatabaseSync["prepare"]>) {
    this.statement = statement;
  }
  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values.map(toSqlInputValue);
    return this;
  }
  async first<T>(): Promise<T | null> {
    return (this.statement.get(...this.values) as T | undefined) ?? null;
  }
  async all<T>(): Promise<D1Result<T>> {
    return { results: this.statement.all(...this.values) as T[], success: true };
  }
  async run(): Promise<D1Result> {
    const result = this.statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1 implements D1Database {
  readonly database = new DatabaseSync(":memory:");
  constructor() {
    this.database.exec(readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8"));
  }
  prepare(query: string): D1PreparedStatement {
    return new SqliteStatement(this.database.prepare(query));
  }
  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.database.exec("BEGIN");
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) {
        const result = await statement.run();
        results.push({ success: result.success, meta: result.meta });
      }
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  close(): void { this.database.close(); }
}

function toSqlInputValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  throw new TypeError("Unsupported SQLite binding value.");
}

const origin = "https://lucky.test";

function environment(db: D1Database, ai?: Env["AI"]): Env {
  return {
    DB: db,
    AI: ai,
    ASSETS: { fetch: async () => new Response("static") },
  };
}

async function call(env: Env, path: string, options: {
  method?: string; body?: unknown; cookie?: string; csrf?: string; origin?: string;
} = {}): Promise<Response> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.csrf) headers.set("X-CSRF-Token", options.csrf);
  if (options.origin !== undefined) headers.set("Origin", options.origin);
  if (options.body !== undefined) headers.set("Content-Length", String(JSON.stringify(options.body).length));
  return worker.fetch(new Request(`${origin}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }), env);
}

async function createAccount(env: Env, email: string): Promise<{ cookie: string; csrf: string }> {
  const response = await call(env, "/api/auth/register", {
    method: "POST",
    origin,
    body: { email, password: "correct horse battery staple" },
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get("Set-Cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  const payload = await response.json() as { csrfToken: string };
  return { cookie, csrf: payload.csrfToken };
}

test("Worker exige autenticação, mesma origem e CSRF para operações da sessão", async () => {
  const db = new SqliteD1();
  const env = environment(db);
  try {
    assert.equal((await call(env, "/api/missions")).status, 401);
    const account = await createAccount(env, "auth@example.test");
    assert.equal((await call(env, "/api/missions", { method: "POST", cookie: account.cookie, csrf: account.csrf, body: { goal: "x" } })).status, 403);
    assert.equal((await call(env, "/api/missions", { method: "POST", cookie: account.cookie, origin, body: { goal: "x" } })).status, 403);
    assert.equal((await call(env, "/api/execute", { cookie: account.cookie })).status, 404);
    assert.equal((await call(env, "/api/auth/logout", { method: "POST", cookie: account.cookie, csrf: account.csrf, origin, body: {} })).status, 200);
    assert.equal((await call(env, "/api/missions", { cookie: account.cookie })).status, 401);
  } finally { db.close(); }
});

test("missões, memórias e auditoria são isoladas por usuário", async () => {
  const db = new SqliteD1();
  const env = environment(db);
  try {
    const alice = await createAccount(env, "alice@example.test");
    const bob = await createAccount(env, "bob@example.test");
    const created = await call(env, "/api/missions", {
      method: "POST", cookie: alice.cookie, csrf: alice.csrf, origin, body: { goal: "missão de Alice" },
    });
    assert.equal(created.status, 201);
    await call(env, "/api/memories", {
      method: "POST", cookie: alice.cookie, csrf: alice.csrf, origin,
      body: { kind: "semantic", content: "privado", confidence: "confirmed", source: "user" },
    });
    const bobMissions = await call(env, "/api/missions", { cookie: bob.cookie });
    const bobMemories = await call(env, "/api/memories", { cookie: bob.cookie });
    assert.deepEqual((await bobMissions.json() as { missions: unknown[] }).missions, []);
    assert.deepEqual((await bobMemories.json() as { memories: unknown[] }).memories, []);
    const audit = await call(env, "/api/audit", { cookie: bob.cookie });
    assert.equal((await audit.json() as { verification: { count: number } }).verification.count, 1);
    const memoryResult = await call(env, "/api/memories", {
      method: "POST", cookie: bob.cookie, csrf: bob.csrf, origin,
      body: { kind: "unapproved", content: "invalid", confidence: "confirmed", source: "user" },
    });
    assert.equal(memoryResult.status, 400);
    assert.equal((await verifyAudit(db, alice.cookie)).ok, true);
  } finally { db.close(); }
});

test("aprovação vincula usuário, argumentos e contexto e só pode ser consumida uma vez", async () => {
  const db = new SqliteD1();
  const env = environment(db);
  try {
    const account = await createAccount(env, "approval@example.test");
    const request = await call(env, "/api/approvals", {
      method: "POST", cookie: account.cookie, csrf: account.csrf, origin,
      body: { tool: "file.write", arguments: { path: "report.txt", content: "ok" }, context: "missão 42" },
    });
    assert.equal(request.status, 201);
    const approvalId = (await request.json() as { id: string }).id;
    assert.equal((await call(env, `/api/approvals/${approvalId}/approve`, {
      method: "POST", cookie: account.cookie, csrf: account.csrf, origin, body: {},
    })).status, 200);
    assert.equal(await consumeApproval(db, "wrong-user", approvalId, {
      tool: "file.write", arguments: { path: "report.txt", content: "ok" }, context: "missão 42",
    }), false);
    assert.equal(await consumeApproval(db, "user-mismatch", approvalId, {
      tool: "file.write", arguments: { path: "report.txt", content: "modified" }, context: "missão 42",
    }), false);
    const user = await db.prepare("SELECT id FROM users WHERE email=?").bind("approval@example.test")
      .first<{ id: string }>();
    assert.ok(user);
    const action = { tool: "file.write", arguments: { path: "report.txt", content: "ok" }, context: "missão 42" };
    assert.equal(await consumeApproval(db, user.id, approvalId, action), true);
    assert.equal(await consumeApproval(db, user.id, approvalId, action), false);
    assert.equal((await verifyAudit(db, user.id)).ok, true);
  } finally { db.close(); }
});

test("resposta indisponível de IA é explícita e não persiste mensagem como concluída", async () => {
  const db = new SqliteD1();
  const env = environment(db);
  try {
    const account = await createAccount(env, "chat@example.test");
    const response = await call(env, "/api/chat", {
      method: "POST", cookie: account.cookie, csrf: account.csrf, origin, body: { content: "olá" },
    });
    assert.equal(response.status, 503);
    const messages = await call(env, "/api/chat", { cookie: account.cookie });
    assert.deepEqual((await messages.json() as { messages: unknown[] }).messages, []);
  } finally { db.close(); }
});

test("auditoria encadeada detecta adulteração", async () => {
  const db = new SqliteD1();
  const env = environment(db);
  try {
    const account = await createAccount(env, "audit@example.test");
    const session = await call(env, "/api/auth/session", { cookie: account.cookie });
    assert.equal(session.status, 200);
    const user = await db.prepare("SELECT id FROM users WHERE email=?").bind("audit@example.test").first<{ id: string }>();
    assert.ok(user);
    assert.equal((await verifyAudit(db, user.id)).ok, true);
    db.database.prepare("UPDATE audit_log SET summary='forjado' WHERE user_id=?").run(user.id);
    assert.equal((await verifyAudit(db, user.id)).ok, false);
  } finally { db.close(); }
});

test("verificação de auditoria confere o cabeçalho persistido", async () => {
  const db = new SqliteD1();
  const env = environment(db);
  try {
    await createAccount(env, "audit-head@example.test");
    const user = await db.prepare("SELECT id FROM users WHERE email=?").bind("audit-head@example.test")
      .first<{ id: string }>();
    assert.ok(user);
    assert.equal((await verifyAudit(db, user.id)).ok, true);
    db.database.prepare("UPDATE audit_heads SET hash='forjado' WHERE user_id=?").run(user.id);
    assert.equal((await verifyAudit(db, user.id)).ok, false);
  } finally { db.close(); }
});
