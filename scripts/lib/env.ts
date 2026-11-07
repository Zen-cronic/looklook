import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Load .env from the repo root into process.env, if it exists. Values are never printed. */
export function loadEnv(): void {
  const file = resolve(process.cwd(), ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}
