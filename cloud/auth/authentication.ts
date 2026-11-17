import type { D1Database, User } from "../types.ts";
import { randomToken, sha256 } from "./password.ts";

const SESSION_DAYS = 7;

export interface AuthenticatedSession {
  user: User;
  csrfToken: string;
  sessionId: string;
}

export async function createSession(db: D1Database, user: User): Promise<{ cookie: string; csrfToken: string }> {
  const token = randomToken();
  const csrfToken = randomToken();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO sessions(id,user_id,token_hash,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?,?)",
  ).bind(id, user.id, await sha256(token), csrfToken, expires, now.toISOString()).run();
  return { cookie: `lucky_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}`, csrfToken };
}

export async function authenticate(db: D1Database, request: Request): Promise<AuthenticatedSession | null> {
  const token = parseCookie(request.headers.get("Cookie") ?? "", "lucky_session");
  if (!token) return null;
  const row = await db.prepare(
    `SELECT sessions.id AS session_id, sessions.csrf_token, users.id, users.email
     FROM sessions JOIN users ON users.id=sessions.user_id
     WHERE sessions.token_hash=? AND sessions.expires_at>?`,
  ).bind(await sha256(token), new Date().toISOString()).first<{
    session_id: string; csrf_token: string; id: string; email: string;
  }>();
  return row ? {
    user: { id: row.id, email: row.email },
    csrfToken: row.csrf_token,
    sessionId: row.session_id,
  } : null;
}

export async function destroySession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id=?").bind(sessionId).run();
}

export function parseCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    if (value.length > 64) return null;
    try { return decodeURIComponent(value); } catch { return null; }
  }
  return null;
}
