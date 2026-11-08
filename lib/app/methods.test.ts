import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PayPalRequest } from "../paypal/client";
import { savedCard } from "./testing";

let dir: string;
const previous = process.env.APP_DATA_DIR;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "methods-data-"));
  process.env.APP_DATA_DIR = dir;
});
afterAll(() => {
  process.env.APP_DATA_DIR = previous;
});

/** A vault stand-in: DELETE waits until released (or fails), then GETs answer 404. */
function slowVault(opts: { failDelete?: boolean } = {}) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const calls: string[] = [];
  const client = {
    request: async (req: PayPalRequest) => {
      calls.push(`${req.method} ${req.path}`);
      if (req.method === "DELETE") {
        await gate;
        if (opts.failDelete) throw Object.assign(new Error("PayPal 500"), { status: 500 });
        return { status: 204, body: undefined };
      }
      throw Object.assign(new Error("not found"), { status: 404 });
    },
  };
  return { client, release, calls };
}

async function withCard(sid: string) {
  const { updateSession } = await import("./store");
  await updateSession(sid, (s) => {
    s.methods.push({ ...savedCard });
  });
}

describe("removing a saved method", () => {
  it("makes the method unusable before PayPal's delete starts", async () => {
    const { removeSavedMethod } = await import("./methods");
    const { loadSession } = await import("./store");
    const { activeMethod } = await import("./payments");
    await withCard("removesession001");
    const vault = slowVault();
    const removing = removeSavedMethod("removesession001", savedCard.id, { client: () => vault.client as never, sleep: async () => {} });
    await new Promise((r) => setTimeout(r, 10));
    expect(vault.calls[0]).toMatch(/^DELETE/);
    expect(activeMethod(loadSession("removesession001"))).toBeUndefined();
    vault.release();
    const r = await removing;
    expect(r.confirmedGone).toBe(true);
    const m = loadSession("removesession001").methods[0];
    expect(m.status).toBe("removed");
    expect(m.revokeConfirmed).toBe(true);
  });

  it("keeps it unusable when PayPal's delete fails, and says removal is pending", async () => {
    const { removeSavedMethod } = await import("./methods");
    const { loadSession } = await import("./store");
    const { activeMethod } = await import("./payments");
    await withCard("removesession002");
    const vault = slowVault({ failDelete: true });
    vault.release();
    const r = await removeSavedMethod("removesession002", savedCard.id, { client: () => vault.client as never, sleep: async () => {} }).catch((e) => e);
    expect(r.status).toBe(502);
    const s = loadSession("removesession002");
    expect(activeMethod(s)).toBeUndefined();
    expect(s.methods[0].status).toBe("removed");
    expect(s.methods[0].revokeConfirmed).toBe(false);
    expect(s.methods[0].revokePending).toBe(true);
  });
});

describe("starting over", () => {
  it("deletes saved methods at PayPal, confirmed by 404, before clearing the session", async () => {
    const { startOver } = await import("./methods");
    const { loadSession } = await import("./store");
    await withCard("resetsession0001");
    const vault = slowVault();
    vault.release();
    const r = await startOver("resetsession0001", { client: () => vault.client as never, sleep: async () => {} });
    expect(vault.calls.filter((c) => c === `DELETE /v3/vault/payment-tokens/${savedCard.vaultId}`)).toHaveLength(1);
    expect(vault.calls.filter((c) => c.startsWith("GET"))).toHaveLength(2);
    expect(r.deleted).toEqual([savedCard.label]);
    expect(loadSession("resetsession0001").methods).toHaveLength(0);
  });

  it("keeps a method whose delete PayPal didn't confirm, as removal pending", async () => {
    const { startOver } = await import("./methods");
    const { loadSession } = await import("./store");
    const { activeMethod } = await import("./payments");
    await withCard("resetsession0002");
    const vault = slowVault({ failDelete: true });
    vault.release();
    const r = await startOver("resetsession0002", { client: () => vault.client as never, sleep: async () => {} });
    expect(r.pending).toEqual([savedCard.label]);
    const s = loadSession("resetsession0002");
    expect(s.methods).toHaveLength(1);
    expect(s.methods[0].revokePending).toBe(true);
    expect(activeMethod(s)).toBeUndefined();
    expect(s.receipts).toHaveLength(0);
  });
});
