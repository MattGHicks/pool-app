import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  /** Port the app (pool-api) connects to. Point pool-api's BRIDGE_HOST/PORT here. */
  PORT: z.coerce.number().int().default(8899),
  /** The real ESP32 RS-485 bridge the guardian relays to. */
  UPSTREAM_HOST: z.string().default("192.168.4.60"),
  UPSTREAM_PORT: z.coerce.number().int().default(8899),
  PUMP_ADDRESS: z.coerce.number().int().default(96), // 0x60
  /** Keep-alive cadence while holding — match pool-api's KEEP_ALIVE_MS. */
  KEEP_ALIVE_MS: z.coerce.number().int().min(1000).default(5000),
  /** Max time to hold the pump after the app vanishes, then release to onboard. */
  FAILOVER_MAX_MS: z.coerce.number().int().min(10_000).default(300_000), // 5 min
  /**
   * Rebuild the ESP32 link if it produces nothing for this long. The app polls at
   * 1 Hz, so a silent upstream is a dead one — and a dead-but-open socket means the
   * pump is getting no keep-alive. Keep in step with pool-api's BRIDGE_IDLE_MS.
   */
  UPSTREAM_IDLE_MS: z.coerce.number().int().min(2000).default(12_000),
  UPSTREAM_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(8000),
});

export const config = EnvSchema.parse(process.env);
export type Config = z.infer<typeof EnvSchema>;
