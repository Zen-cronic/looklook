import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ResponseCache {
  get(key: string): unknown | undefined;
  set(key: string, value: unknown): void;
}

export function cacheKey(method: string, path: string, body?: unknown): string {
  return createHash("sha256").update(`${method} ${path} ${body === undefined ? "" : JSON.stringify(body)}`).digest("hex").slice(0, 24);
}

/**
 * Local response cache for offline scripts (the replay). It lives under
 * data/cache/, which is gitignored: raw catalogue responses are never committed.
 */
export class FileCache implements ResponseCache {
  constructor(private readonly dir = "data/cache/channel3") {}

  get(key: string): unknown | undefined {
    const file = join(this.dir, `${key}.json`);
    if (!existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, "utf8"));
  }

  set(key: string, value: unknown): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${key}.json`), JSON.stringify(value));
  }
}
