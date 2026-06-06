import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().default(3001),
  BRIDGE_HOST: z.string().default("192.168.4.60"),
  BRIDGE_PORT: z.coerce.number().int().default(8899),
  PUMP_ADDRESS: z.coerce.number().int().default(96), // 0x60
  // DB connection: either a full DATABASE_URL, or discrete parts (preferred in
  // prod so passwords with URL-special chars like '/' work without encoding).
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_USER: z.string().default("pool"),
  DB_PASSWORD: z.string().optional(),
  DB_NAME: z.string().default("pool"),
  // Timezone the schedules are evaluated in. The container runs in UTC, but
  // users set schedule times in their local wall clock — this keeps the two
  // in sync so the pump runs at the right hour. Matt is Eastern.
  POOL_TZ: z.string().default("America/New_York"),
  POLL_MS: z.coerce.number().int().min(250).default(1000),
  KEEP_ALIVE_MS: z.coerce.number().int().min(1000).default(5000),
  SESSION_SECRET: z.string().min(16).default("dev-only-insecure-secret-change-me-now"),
  // Either a precomputed scrypt hash, OR a plaintext password (hashed at startup).
  // POOL_PASSWORD takes precedence — handy because a 161-char hash is easy to truncate.
  POOL_PASSWORD_HASH: z.string().optional(),
  POOL_PASSWORD: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),
  // Set to ".mght630.com" in prod so the session cookie is shared between
  // pool.mght630.com (web) and poolapi.mght630.com (api). Unset in dev (host-only).
  COOKIE_DOMAIN: z.string().optional(),
});

export const config = EnvSchema.parse(process.env);
export type Config = z.infer<typeof EnvSchema>;
