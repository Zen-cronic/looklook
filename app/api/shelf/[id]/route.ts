import { handle, HttpError, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { updateSession } from "@/lib/app/store";
import { ShelfValidationError, validateShelfItem } from "@/lib/shelf/store";
import type { ShelfItem } from "@/lib/shelf/types";

/** Mark opened, set a run-out date or a price. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/shelf/[id]">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    const body = await readJsonBody<Partial<Pick<ShelfItem, "opened" | "runOutDate" | "price" | "cycleDays">>>(request);
    const item = await updateSession(sid, (s) => {
      const i = s.shelf.findIndex((x) => x.id === id);
      if (i < 0) throw new HttpError(404, "No such shelf item.");
      const patch: Partial<ShelfItem> = {};
      if (typeof body.opened === "boolean") patch.opened = body.opened;
      if (body.runOutDate !== undefined) patch.runOutDate = body.runOutDate || null;
      if (body.price !== undefined) patch.price = body.price ?? undefined;
      if (body.cycleDays !== undefined) patch.cycleDays = body.cycleDays;
      try {
        s.shelf[i] = validateShelfItem({ ...s.shelf[i], ...patch });
      } catch (e) {
        if (e instanceof ShelfValidationError) throw new HttpError(400, e.message);
        throw e;
      }
      return s.shelf[i];
    });
    return Response.json({ item });
  });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/shelf/[id]">) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const { id } = await ctx.params;
    await updateSession(sid, (s) => {
      const before = s.shelf.length;
      s.shelf = s.shelf.filter((x) => x.id !== id);
      if (s.shelf.length === before) throw new HttpError(404, "No such shelf item.");
    });
    return Response.json({ removed: id });
  });
}
