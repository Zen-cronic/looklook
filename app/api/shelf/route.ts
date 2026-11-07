import { connection } from "next/server";
import { handle, HttpError, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { loadSession, updateSession } from "@/lib/app/store";
import { isCategory } from "@/lib/shelf/categories";
import { ShelfValidationError, validateShelfItem } from "@/lib/shelf/store";
import type { ShelfItemInput } from "@/lib/shelf/types";

export async function GET() {
  await connection();
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    return Response.json({ items: loadSession(sid).shelf });
  });
}

/** Add an item by hand. */
export async function POST(request: Request) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const body = await readJsonBody<Partial<ShelfItemInput>>(request);
    if (!isCategory(body.category)) throw new HttpError(400, "Pick a category.");
    let item;
    try {
      item = validateShelfItem({
        brand: String(body.brand ?? ""),
        name: String(body.name ?? ""),
        category: body.category,
        attributes: body.attributes ?? {},
        opened: !!body.opened,
        runOutDate: body.runOutDate || null,
        price: typeof body.price === "number" ? body.price : undefined,
        source: "manual",
      });
    } catch (e) {
      if (e instanceof ShelfValidationError) throw new HttpError(400, e.message);
      throw e;
    }
    await updateSession(sid, (s) => {
      s.shelf.push(item);
    });
    return Response.json({ item });
  });
}
