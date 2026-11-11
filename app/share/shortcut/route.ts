import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SHORTCUT_FILE, SHORTCUT_NAME } from "@/lib/app/shortcut";

/**
 * The signed "Look twice" Shortcut. Opened in Safari on an iPhone, the
 * Shortcuts app shows it with an Add Shortcut button; the file name becomes
 * the shortcut's name.
 */
export async function GET() {
  const bytes = await readFile(join(process.cwd(), SHORTCUT_FILE));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${SHORTCUT_NAME}.shortcut"`,
      "cache-control": "no-store",
    },
  });
}
