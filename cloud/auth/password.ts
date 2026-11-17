const ITERATIONS = 600_000;
const encoder = new TextEncoder();

export async function hashPassword(password: string, salt = randomToken()): Promise<{ hash: string; salt: string; iterations: number }> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(decodeToken(salt)), iterations: ITERATIONS },
    key,
    256,
  );
  return { hash: encodeToken(new Uint8Array(bits)), salt, iterations: ITERATIONS };
}

export async function verifyPassword(password: string, salt: string, expected: string, iterations: number): Promise<boolean> {
  if (!Number.isInteger(iterations) || iterations < 600_000 || iterations > 1_000_000) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(decodeToken(salt)), iterations },
    key,
    256,
  );
  return constantTimeEqual(encodeToken(new Uint8Array(bits)), expected);
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return encodeToken(bytes);
}

export function encodeToken(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeToken(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return encodeToken(new Uint8Array(digest));
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return difference === 0;
}
