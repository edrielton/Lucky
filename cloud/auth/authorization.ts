import type { AuthenticatedSession } from "./authentication.ts";

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin !== null && origin === new URL(request.url).origin;
}

export function hasValidCsrf(request: Request, session: AuthenticatedSession): boolean {
  const actual = request.headers.get("X-CSRF-Token") ?? "";
  const expected = session.csrfToken;
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < Math.max(actual.length, expected.length); index++) {
    difference |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}
