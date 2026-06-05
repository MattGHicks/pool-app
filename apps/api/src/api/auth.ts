import crypto from "node:crypto";
import { config } from "../config.js";

const SCRYPT_KEYLEN = 64;
export const COOKIE_NAME = "pool_session";
export const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Hash a password as `salt:scryptHash` (both hex). */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const computed = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
}

function hmac(payload: string): string {
  return crypto.createHmac("sha256", config.SESSION_SECRET).update(payload).digest("base64url");
}

/** Create a signed session token `<expiryMs>.<hmac>`. */
export function createSessionToken(ttlMs: number = SESSION_TTL_MS): string {
  const payload = String(Date.now() + ttlMs);
  return `${payload}.${hmac(payload)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = hmac(payload);
  if (mac.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && Date.now() < exp;
}

// --- simple in-memory login rate limiter (per IP) ---
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  rec.count += 1;
  return rec.count <= MAX_ATTEMPTS;
}

export function resetRateLimit(ip: string): void {
  attempts.delete(ip);
}
