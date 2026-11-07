import { handle, HttpError, readJsonBody, sessionIdOrThrow } from "@/lib/app/http";
import { resetSession, updateSession } from "@/lib/app/store";
import { negativeTestingEnabled } from "@/lib/paypal";

/**
 * Test controls, shown with labels in the app: move the simulated date,
 * make the next rebuy decline in the PayPal sandbox, or start over.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const body = await readJsonBody<{ action?: string; days?: number; on?: boolean }>(request);
    if (body.action === "reset") {
      await resetSession(sid);
      return Response.json({ reset: true });
    }
    if (body.action === "shift-days") {
      const days = Number(body.days);
      if (!Number.isInteger(days) || Math.abs(days) > 365) throw new HttpError(400, "days must be a whole number.");
      const dayOffset = await updateSession(sid, (s) => {
        s.dayOffset = Math.max(0, Math.min(365, s.dayOffset + days));
        return s.dayOffset;
      });
      return Response.json({ dayOffset });
    }
    if (body.action === "today") {
      await updateSession(sid, (s) => {
        s.dayOffset = 0;
      });
      return Response.json({ dayOffset: 0 });
    }
    if (body.action === "decline-next") {
      if (body.on && !negativeTestingEnabled()) throw new HttpError(409, "Simulated declines are off on this server.");
      await updateSession(sid, (s) => {
        s.demo.declineNextRebuy = !!body.on;
      });
      return Response.json({ declineNextRebuy: !!body.on });
    }
    throw new HttpError(400, "Unknown action.");
  });
}
