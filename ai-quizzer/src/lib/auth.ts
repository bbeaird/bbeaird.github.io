import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "crypto";
import { cookies } from "next/headers";
import { getDb } from "./db";

const SESSION_COOKIE = "aiq_session";
const SESSION_DAYS = 30;

// In production set AIQ_SECRET; the dev fallback keeps local setup zero-config.
const SECRET = process.env.AIQ_SECRET ?? "dev-secret-change-me";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

export function createSessionToken(userId: number): string {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function parseSessionToken(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, sig] = parts;
  const payload = `${userId}.${expires}`;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expires) < Date.now()) return null;
  return Number(userId);
}

export interface SessionUser {
  id: number;
  email: string;
  streak_count: number;
  last_quiz_date: string | null;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = parseSessionToken(token);
  if (userId === null) return null;
  const user = getDb()
    .prepare("SELECT id, email, streak_count, last_quiz_date FROM users WHERE id = ?")
    .get(userId) as SessionUser | undefined;
  return user ?? null;
}

export function sessionCookie(userId: number) {
  return {
    name: SESSION_COOKIE,
    value: createSessionToken(userId),
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

export function clearedSessionCookie() {
  return { name: SESSION_COOKIE, value: "", httpOnly: true, path: "/", maxAge: 0 };
}
