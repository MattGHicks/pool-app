import type { NextConfig } from "next";
import { join } from "node:path";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@pool/types"],
  // Standalone output for a small Docker runtime image. Trace from the monorepo
  // root so workspace deps (@pool/types) are bundled.
  output: "standalone",
  outputFileTracingRoot: join(import.meta.dirname, "../../"),
};

export default config;
