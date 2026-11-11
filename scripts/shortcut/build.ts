/**
 * Build the signed "Look twice" Shortcut that /share/shortcut hands to an
 * iPhone. Needs a Mac (the `plutil` and `shortcuts` command-line tools) and
 * an Apple account signed in, because the Shortcuts app only imports signed
 * files. The address it opens is fixed when it is built:
 *
 *   npx tsx scripts/shortcut/build.ts [base]   # default: the hosted app
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHORTCUT_BASE, SHORTCUT_FILE } from "../../lib/app/shortcut";
import { shortcutWorkflow } from "./workflow";

const base = (process.argv[2] ?? SHORTCUT_BASE).replace(/\/$/, "");
const out = process.argv[3] ?? join(process.cwd(), SHORTCUT_FILE);
const dir = mkdtempSync(join(tmpdir(), "look-twice-"));
const json = join(dir, "Look twice.json");
const unsigned = join(dir, "Look twice.shortcut");
writeFileSync(json, JSON.stringify(shortcutWorkflow(base)));
execFileSync("plutil", ["-convert", "binary1", json, "-o", unsigned]);
execFileSync("shortcuts", ["sign", "--mode", "anyone", "--input", unsigned, "--output", out]);
console.log(`Signed shortcut for ${base}: ${out}`);
