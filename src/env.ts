import { existsSync } from "node:fs";

/** Loads ./.env into process.env if present. Real environment variables win over the file. */
export function loadDotEnv(path = ".env"): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
