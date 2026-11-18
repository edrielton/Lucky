import { authenticate, createSession, destroySession } from "./auth/authentication.ts";
import { hasValidCsrf, isSameOrigin } from "./auth/authorization.ts";
import { hashPassword, randomToken, sha256, verifyPassword } from "./auth/password.ts";
import { appendAudit, verifyAudit } from "./security/audit.ts";
import { createApproval, decideApproval } from "./security/approval.ts";
import type { D1Database, Env, User } from "./types.ts";

const MEMORY_KINDS = new Set(["working", "episodic", "semantic", "procedural", "preference", "project", "research", "system"]);
const CONFIDENCE = new Set(["observed", "inferred", "confirmed"]);
const EXPERIENCE_KINDS = new Set(["observation", "error", "solution", "outcome"]);
const MODELS = new Set(["@cf/meta/llama-3.1-8b-instruct-fast", "@cf/meta/llama-3.1-8b-instruct"]);
const bodyLimit = 32_000;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { Allow: "GET, POST, PUT, OPTIONS" } });
      return await handleApi(request, env, url);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error("Lucky Cloud request failed", error);
      return json({ error: "Falha interna da solicitação." }, 500);
    }
  },
};

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;
  // Public, non-sensitive diagnostic endpoint. It confirms whether requests reach
  // this Worker and whether its configured database binding is usable.
  if (pathname === "/api/health" && request.method === "GET") {
    try {
      await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
      return json({ ok: true, service: "lucky-cloud", database: "connected" });
    } catch (error) {
      console.error("Lucky Cloud health check failed", error);
      return json({ ok: false, service: "lucky-cloud", database: "unavailable" }, 503);
    }
  }
  if (pathname === "/api/auth/register" && request.method === "POST") return register(request, env.DB);
  if (pathname === "/api/auth/login" && request.method === "POST") return login(request, env.DB);

  const session = await authenticate(env.DB, request);
  if (!session) throw new HttpError(401, "Autenticação necessária.");
  if (request.method !== "GET") {
    requireJson(request);
    if (!isSameOrigin(request)) throw new HttpError(403, "Origem inválida.");
    if (!hasValidCsrf(request, session)) throw new HttpError(403, "Token CSRF inválido.");
  }

  if (pathname === "/api/auth/session" && request.method === "GET") {
    return json({ user: session.user, csrfToken: session.csrfToken });
  }
  if (pathname === "/api/auth/logout" && request.method === "POST") {
    await destroySession(env.DB, session.sessionId);
    return json({ ok: true }, 200, { "Set-Cookie": expiredCookie() });
  }
  if (pathname === "/api/chat" && (request.method === "GET" || request.method === "POST")) {
    return chat(request, env, session.user);
  }
  if (pathname === "/api/missions" && (request.method === "GET" || request.method === "POST")) {
    return missions(request, env.DB, session.user);
  }
  if (pathname === "/api/memories" && (request.method === "GET" || request.method === "POST")) {
    return memories(request, env.DB, session.user);
  }
  if (pathname === "/api/experiences" && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT id,kind,context,action,result,confidence,created_at FROM experiences WHERE user_id=? ORDER BY created_at DESC LIMIT 200",
    ).bind(session.user.id).all();
    return json({ experiences: result.results ?? [] });
  }
  if (pathname === "/api/experiences" && request.method === "POST") {
    return createExperience(request, env.DB, session.user);
  }
  if (pathname === "/api/learning" && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT fingerprint,category,summary,occurrences,evidence_ids_json,confidence,updated_at FROM learning_insights WHERE user_id=? ORDER BY updated_at DESC LIMIT 200",
    ).bind(session.user.id).all();
    return json({ insights: result.results ?? [] });
  }
  if (pathname === "/api/approvals" && (request.method === "GET" || request.method === "POST")) {
    return approvals(request, env.DB, session.user);
  }
  const approvalMatch = pathname.match(/^\/api\/approvals\/([0-9a-f-]{36})\/(approve|reject)$/u);
  if (approvalMatch && request.method === "POST") {
    const decision = approvalMatch[2] === "approve" ? "approved" : "rejected";
    const changed = await decideApproval(env.DB, session.user.id, approvalMatch[1], decision);
    if (!changed) throw new HttpError(409, "A aprovação não existe, expirou ou já foi decidida.");
    return json({ status: decision });
  }
  if (pathname === "/api/audit" && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT sequence,created_at,kind,subject,summary,previous_hash,hash FROM audit_log WHERE user_id=? ORDER BY sequence DESC LIMIT 200",
    ).bind(session.user.id).all();
    return json({ entries: result.results ?? [], verification: await verifyAudit(env.DB, session.user.id) });
  }
  if (pathname === "/api/settings" && (request.method === "GET" || request.method === "PUT")) {
    return settings(request, env.DB, session.user);
  }
  throw new HttpError(404, "Rota não encontrada.");
}

async function register(request: Request, db: D1Database): Promise<Response> {
  requireJson(request);
  const input = await readBody(request);
  const email = stringField(input.email, "email", 254).toLowerCase();
  const password = stringField(input.password, "senha", 256);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || password.length < 12) {
    throw new HttpError(400, "Informe um e-mail válido e uma senha com pelo menos 12 caracteres.");
  }
  if (!isSameOrigin(request)) throw new HttpError(403, "Origem inválida.");
  await checkRateLimit(db, request, `register:${email}`);
  const id = crypto.randomUUID();
  const passwordData = await hashPassword(password);
  const user: User = { id, email };
  try {
    await db.prepare(
      "INSERT INTO users(id,email,password_hash,password_salt,password_iterations,created_at) VALUES(?,?,?,?,?,?)",
    ).bind(id, email, passwordData.hash, passwordData.salt, passwordData.iterations, new Date().toISOString()).run();
    await db.prepare("INSERT INTO user_settings(user_id,updated_at) VALUES(?,?)").bind(id, new Date().toISOString()).run();
  } catch (error) {
    if (isUniqueError(error)) throw new HttpError(409, "Não foi possível criar uma conta com esses dados.");
    throw error;
  }
  await appendAudit(db, user.id, "account_created", "account", "Conta criada");
  return sessionResponse(db, user, 201);
}

async function login(request: Request, db: D1Database): Promise<Response> {
  requireJson(request);
  if (!isSameOrigin(request)) throw new HttpError(403, "Origem inválida.");
  const input = await readBody(request);
  const email = stringField(input.email, "email", 254).toLowerCase();
  const password = stringField(input.password, "senha", 256);
  await checkRateLimit(db, request, `login:${email}`);
  const row = await db.prepare(
    "SELECT id,email,password_hash,password_salt,password_iterations FROM users WHERE email=?",
  ).bind(email).first<{
    id: string; email: string; password_hash: string; password_salt: string; password_iterations: number;
  }>();
  const valid = row
    ? await verifyPassword(password, row.password_salt, row.password_hash, row.password_iterations)
    : await verifyPassword(password, "AAAAAAAAAAAAAAAAAAAAAA", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", 600_000);
  if (!row || !valid) throw new HttpError(401, "E-mail ou senha inválidos.");
  await db.prepare("DELETE FROM auth_attempts WHERE key=?").bind(await rateKey(request, `login:${email}`)).run();
  await appendAudit(db, row.id, "login", "account", "Sessão iniciada");
  return sessionResponse(db, { id: row.id, email: row.email }, 200);
}

async function sessionResponse(db: D1Database, user: User, status: number): Promise<Response> {
  const session = await createSession(db, user);
  return json({ user, csrfToken: session.csrfToken }, status, { "Set-Cookie": session.cookie });
}

async function checkRateLimit(db: D1Database, request: Request, action: string): Promise<void> {
  const key = await rateKey(request, action);
  const now = Date.now();
  await db.prepare(
    `INSERT INTO auth_attempts(key,attempts,window_started_at,blocked_until) VALUES(?,1,?,0)
     ON CONFLICT(key) DO UPDATE SET
       attempts=CASE WHEN window_started_at<? THEN 1 ELSE attempts+1 END,
       window_started_at=CASE WHEN window_started_at<? THEN excluded.window_started_at ELSE window_started_at END,
       blocked_until=CASE WHEN window_started_at<? THEN 0
         WHEN attempts+1>=8 THEN ? ELSE blocked_until END`,
  ).bind(key, now, now - 900_000, now - 900_000, now - 900_000, now + 900_000).run();
  const row = await db.prepare("SELECT blocked_until FROM auth_attempts WHERE key=?").bind(key)
    .first<{ blocked_until: number }>();
  if (row && row.blocked_until > now) throw new HttpError(429, "Muitas tentativas. Tente novamente mais tarde.");
}

async function rateKey(request: Request, action: string): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  return sha256(`${ip}\u0000${action}`);
}

async function missions(request: Request, db: D1Database, user: User): Promise<Response> {
  if (request.method === "GET") {
    const result = await db.prepare(
      "SELECT id,goal,status,created_at FROM missions WHERE user_id=? ORDER BY created_at DESC LIMIT 200",
    ).bind(user.id).all();
    return json({ missions: result.results ?? [] });
  }
  const input = await readBody(request);
  const goal = stringField(input.goal, "objetivo", 2000).trim();
  if (!goal) throw new HttpError(400, "Objetivo obrigatório.");
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.prepare("INSERT INTO missions(id,user_id,goal,status,created_at) VALUES(?,?,?,'PENDING',?)")
    .bind(id, user.id, goal, createdAt).run();
  await appendAudit(db, user.id, "mission_created", id, goal);
  return json({ mission: { id, goal, status: "PENDING", created_at: createdAt } }, 201);
}

async function memories(request: Request, db: D1Database, user: User): Promise<Response> {
  if (request.method === "GET") {
    const result = await db.prepare(
      "SELECT id,kind,content,confidence,source,tags_json,metadata_json,created_at FROM memories WHERE user_id=? ORDER BY created_at DESC LIMIT 200",
    ).bind(user.id).all();
    return json({ memories: result.results ?? [] });
  }
  const input = await readBody(request);
  const kind = stringField(input.kind, "tipo", 24);
  const confidence = stringField(input.confidence, "confiança", 16);
  const content = stringField(input.content, "conteúdo", 20_000).trim();
  const source = stringField(input.source, "fonte", 200).trim();
  if (!MEMORY_KINDS.has(kind) || !CONFIDENCE.has(confidence) || !content || !source) {
    throw new HttpError(400, "Tipo, confiança, conteúdo ou fonte inválidos.");
  }
  const tags = input.tags === undefined ? [] : input.tags;
  if (!Array.isArray(tags) || tags.length > 30 || !tags.every((tag) => typeof tag === "string" && tag.length <= 80)) {
    throw new HttpError(400, "Tags inválidas.");
  }
  const metadata = input.metadata === undefined ? {} : input.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new HttpError(400, "Metadados inválidos.");
  if (JSON.stringify(metadata).length > 4000) throw new HttpError(400, "Metadados excedem o limite.");
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.prepare(
    "INSERT INTO memories(id,user_id,kind,content,confidence,source,tags_json,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
  ).bind(id, user.id, kind, content, confidence, source, JSON.stringify(tags), JSON.stringify(metadata), createdAt).run();
  await appendAudit(db, user.id, "memory_created", id, `Memória ${kind} (${confidence})`);
  return json({ memory: { id, kind, content, confidence, source, tags, metadata, created_at: createdAt } }, 201);
}

async function createExperience(request: Request, db: D1Database, user: User): Promise<Response> {
  const input = await readBody(request);
  const kind = stringField(input.kind, "tipo", 24);
  const context = stringField(input.context, "contexto", 300);
  const action = stringField(input.action, "ação", 300);
  const result = stringField(input.result, "resultado", 1000);
  const confidence = input.confidence === undefined ? "observed" : stringField(input.confidence, "confiança", 16);
  if (!EXPERIENCE_KINDS.has(kind) || !CONFIDENCE.has(confidence)) throw new HttpError(400, "Experiência inválida.");
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.prepare(
    "INSERT INTO experiences(id,user_id,kind,context,action,result,confidence,created_at) VALUES(?,?,?,?,?,?,?,?)",
  ).bind(id, user.id, kind, context, action, result, confidence, createdAt).run();
  await appendAudit(db, user.id, "experience_recorded", id, `Experiência ${kind}`);
  return json({ experience: { id, kind, context, action, result, confidence, created_at: createdAt } }, 201);
}

async function approvals(request: Request, db: D1Database, user: User): Promise<Response> {
  if (request.method === "GET") {
    const result = await db.prepare(
      "SELECT id,tool,arguments_json,context,status,expires_at,created_at,decided_at FROM approvals WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
    ).bind(user.id).all();
    return json({ approvals: result.results ?? [] });
  }
  const input = await readBody(request);
  const tool = stringField(input.tool, "ferramenta", 100);
  const context = stringField(input.context, "contexto", 1000);
  const args = input.arguments;
  if (!/^[a-zA-Z0-9_.:-]+$/u.test(tool) || !args || typeof args !== "object" || Array.isArray(args)) {
    throw new HttpError(400, "Ação de aprovação inválida.");
  }
  if (JSON.stringify(args).length > 8000) throw new HttpError(400, "Argumentos excedem o limite.");
  const id = await createApproval(db, user.id, { tool, arguments: args as Record<string, unknown>, context });
  return json({ id, status: "pending", expiresInSeconds: 600 }, 201);
}

async function settings(request: Request, db: D1Database, user: User): Promise<Response> {
  if (request.method === "GET") {
    const row = await db.prepare("SELECT provider,model,updated_at FROM user_settings WHERE user_id=?")
      .bind(user.id).first();
    return json({ settings: row ?? { provider: "none", model: [...MODELS][0] } });
  }
  const input = await readBody(request);
  const provider = stringField(input.provider, "provedor", 32);
  const model = stringField(input.model, "modelo", 100);
  if (!new Set(["none", "cloudflare-ai"]).has(provider) || !MODELS.has(model)) {
    throw new HttpError(400, "Provedor ou modelo não suportado.");
  }
  const updatedAt = new Date().toISOString();
  await db.prepare(
    `INSERT INTO user_settings(user_id,provider,model,updated_at) VALUES(?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,updated_at=excluded.updated_at`,
  ).bind(user.id, provider, model, updatedAt).run();
  await appendAudit(db, user.id, "provider_settings_changed", "settings", `Provedor: ${provider}`);
  return json({ settings: { provider, model, updated_at: updatedAt } });
}

async function chat(request: Request, env: Env, user: User): Promise<Response> {
  if (request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT role,content,created_at FROM chat_messages WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
    ).bind(user.id).all();
    return json({ messages: (result.results ?? []).reverse() });
  }
  const input = await readBody(request);
  const content = stringField(input.content, "mensagem", 8000).trim();
  if (!content) throw new HttpError(400, "Mensagem obrigatória.");
  await checkRateLimit(env.DB, request, `chat:${user.id}`);
  const settings = await env.DB.prepare("SELECT provider,model FROM user_settings WHERE user_id=?")
    .bind(user.id).first<{ provider: string; model: string }>();
  if (settings?.provider !== "cloudflare-ai" || !env.AI) {
    throw new HttpError(503, "Provedor de IA indisponível ou não configurado. Nenhuma resposta foi gerada.");
  }
  const history = await env.DB.prepare(
    "SELECT role,content FROM chat_messages WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
  ).bind(user.id).all<{ role: string; content: string }>();
  const messages = [
    { role: "system", content: "Você é Lucky Cloud. Não execute ferramentas, não afirme que realizou ações. Ações sensíveis exigem aprovação humana." },
    ...(history.results ?? []).reverse(),
    { role: "user", content },
  ];
  let modelResult: unknown;
  try {
    modelResult = await env.AI.run(settings.model, { messages });
  } catch (error) {
    console.error("Cloudflare AI unavailable", error);
    throw new HttpError(502, "O provedor de IA falhou. A mensagem não foi registrada como respondida.");
  }
  const answer = modelResult && typeof modelResult === "object" && "response" in modelResult
    ? (modelResult as { response: unknown }).response : null;
  if (typeof answer !== "string" || !answer.trim() || answer.length > 12_000) {
    throw new HttpError(502, "O provedor retornou uma resposta inválida.");
  }
  const now = new Date().toISOString();
  const assistantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO chat_messages(id,user_id,role,content,created_at) VALUES(?,?, 'user',?,?)")
    .bind(userId, user.id, content, now).run();
  await env.DB.prepare("INSERT INTO chat_messages(id,user_id,role,content,created_at) VALUES(?,?, 'assistant',?,?)")
    .bind(assistantId, user.id, answer, now).run();
  await appendAudit(env.DB, user.id, "chat", "assistant", "Interação com provedor de IA");
  return json({ answer });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > bodyLimit) throw new HttpError(413, "Corpo da solicitação excede o limite.");
  const text = await request.text();
  if (text.length > bodyLimit) throw new HttpError(413, "Corpo da solicitação excede o limite.");
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required");
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Corpo JSON inválido.");
  }
}

function requireJson(request: Request): void {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Use Content-Type application/json.");
  }
}

function stringField(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength) throw new HttpError(400, `Campo ${name} inválido.`);
  return value;
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/iu.test(error.message);
}

function expiredCookie(): string {
  return "lucky_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0";
}

function json(value: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
  });
}
