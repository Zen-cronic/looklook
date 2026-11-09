import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import policies from "@/data/return-policies.json";
import { proxy } from "../../proxy";
import { checkoutOrderBody, recordDecline, recordPaid, sourceDetails, type PaidResult } from "../app/payments";
import { SAMPLES } from "../app/samples";
import { sampleWeekState } from "../app/sample-week";
import { seedState } from "../app/seed";
import type { SavedMethod, SessionState } from "../app/types";
import { applyPriceEvent, newWatch, simulatedDropEvent } from "../app/watch";
import { landingSample } from "../app/landing";
import { returnsLine } from "../app/explain";
import { SHARE_ERRORS, sharedInput, validateSharedLink } from "../app/share";
import { shelfLink } from "../app/shelf-link";
import { studioPayload } from "../studio/tables";
import { FILM_COOKIE, filmFromCookie, filmFromEnv, filmParam } from "./flag";
import { BRANDS, compactSimulated, FILM_IMAGES, FILM_SAMPLES, namesABrand, neutralText, PRODUCT_TABLE, productImage, productName, shortId, STORE_DOMAINS, STORE_LABEL_STYLE, storeLabel, uniqueStoreLabels } from "./neutral";
import { filmState, neutralDeep } from "./view";
import { visibleText } from "./visible";

const TODAY = "2026-11-10";
const NOW = new Date("2026-11-10T15:00:00Z");

const method: SavedMethod = {
  id: "pm_1",
  type: "card",
  vaultId: "8XY12345AB678901C",
  label: "Visa ending 1111",
  capCents: 5000,
  currency: "USD",
  consentText: "Save Visa ending 1111 for rebuys you approve.",
  consentedAt: NOW.toISOString(),
  firstOrderId: "5O190127TN364715T",
  status: "active",
};

const paid = (orderId: string, amountCents: number): PaidResult => ({
  outcome: { orderId, orderStatus: "COMPLETED", captureId: "3C679366HH908993F", captureStatus: "COMPLETED", amountCents, currency: "USD" },
  requestId: "rebuy:abc",
  kind: "saved-method",
  methodLabel: method.label,
  methodId: method.id,
});

/** The sample week after the film's path: a saved card, a rebuy, a watched price drop, a decline and their notices. */
function filmedWeek(): SessionState {
  const s = sampleWeekState("filmsession0001", TODAY, undefined, NOW);
  s.methods.push(method);
  s.dayOffset = 6;
  const staple = { kind: "staple" as const, shelfItemId: "sh-cleanser", cycle: s.shelf.find((i) => i.id === "sh-cleanser")!.runOutDate! };
  const details = sourceDetails(s, staple);
  recordPaid(s, staple, details, paid("5O190127TN364715T", details.amountCents), "2026-11-16", NOW);
  const mascara = { kind: "staple" as const, shelfItemId: "sh-mascara", cycle: s.shelf.find((i) => i.id === "sh-mascara")!.runOutDate! };
  recordDecline(s, mascara, sourceDetails(s, mascara), method, { issue: "INSTRUMENT_DECLINED", simulated: true }, NOW);
  const retinol = s.checks.find((c) => c.id === "week-retinol")!;
  const watch = newWatch(retinol, { status: "active", id: "sub_1" }, NOW, s.shelf);
  s.watch.push(watch);
  applyPriceEvent(s, simulatedDropEvent(watch, watch.targetPrice), NOW);
  s.notices.push({ id: "n1", at: NOW.toISOString(), text: "Paid $16.97 for CeraVe Hydrating Facial Cleanser with Visa ending 1111. PayPal order 5O190127TN364715T.", ids: [{ label: "PayPal order", value: "5O190127TN364715T" }] });
  return s;
}

/** Every string a page could print from a record: links, image paths and ids aside. */
function shownStrings(value: unknown, key = ""): string[] {
  if (typeof value === "string") return /(Url|url|href|^id|Id|Ids|imageHash|approvalKey|sample|cycle|domain|offerDomain|sourceRef)$/.test(key) ? [] : [value];
  if (Array.isArray(value)) return value.flatMap((v) => shownStrings(v, key));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => shownStrings(v, k));
  return [];
}

describe("filming mode switch", () => {
  it("is off by default", () => {
    expect(filmFromEnv({})).toBe(false);
    expect(filmFromEnv({ NEXT_PUBLIC_FILM_MODE: "" })).toBe(false);
    expect(filmFromEnv({ NEXT_PUBLIC_FILM_MODE: "true" })).toBe(false);
    expect(filmFromCookie(undefined)).toBe(false);
    expect(filmFromCookie("0")).toBe(false);
    expect(filmParam(new URLSearchParams(""))).toBeNull();
    expect(filmFromEnv({ NEXT_PUBLIC_FILM_MODE: "1" })).toBe(true);
    expect(filmParam(new URLSearchParams("film=1"))).toBe("on");
    expect(filmParam(new URLSearchParams("film=0"))).toBe("off");
    expect(process.env.NEXT_PUBLIC_FILM_MODE ?? "").not.toBe("1");
    expect(STORE_LABEL_STYLE).toBe("descriptive");
  });

  it("stays off for a visit without ?film=1, and ?film=1 turns it on for the browser session", async () => {
    process.env.SESSION_SECRET ??= "film-test-secret-0123456789abcdef";
    const plain = await proxy(new NextRequest("http://localhost/"));
    expect(plain.headers.get("x-middleware-rewrite")).toBeNull();
    expect(plain.headers.get("set-cookie") ?? "").not.toContain(`${FILM_COOKIE}=`);

    const on = await proxy(new NextRequest("http://localhost/?film=1"));
    expect(on.headers.get("x-middleware-rewrite")).toContain("/filming");
    const cookie = (on.headers.get("set-cookie") ?? "").split(", ").find((c) => c.startsWith(`${FILM_COOKIE}=`)) ?? "";
    expect(cookie).toContain(`${FILM_COOKIE}=1`);
    // Ends with the browser session: no lifetime of its own.
    expect(cookie.toLowerCase()).not.toMatch(/max-age|expires/);

    const page = await proxy(new NextRequest("http://localhost/rebuys", { headers: { cookie: `${FILM_COOKIE}=1` } }));
    expect(page.headers.get("x-middleware-rewrite")).toBeNull();

    const off = await proxy(new NextRequest("http://localhost/?film=0", { headers: { cookie: `${FILM_COOKIE}=1` } }));
    expect(off.headers.get("x-middleware-rewrite")).toBeNull();
    expect(off.headers.get("set-cookie") ?? "").toMatch(new RegExp(`${FILM_COOKIE}=;`));
  });
});

describe("filming mode names", () => {
  it("has a generic name for every bundled product, and none of them names a brand", () => {
    for (const p of PRODUCT_TABLE) {
      expect(p.neutral, `${p.brand} ${p.name}`).toBeTruthy();
      expect(namesABrand(p.neutral), `${p.brand} ${p.name} -> ${p.neutral}`).toBeNull();
      expect(p.neutral).not.toContain(p.brand);
    }
    expect(BRANDS.length).toBeGreaterThan(50);
  });

  it("names every store in the sample week, the sample posts and the policy table by its kind", () => {
    const s = sampleWeekState("filmsession0002", TODAY, undefined, NOW);
    const stores = [
      ...s.checks.flatMap((c) => [c.store, c.fields.store]),
      ...s.shelf.map((i) => i.store),
      ...(policies as { retailers: Array<{ id: string; name: string; domains: string[] }> }).retailers.flatMap((r) => [r.id, r.name, ...r.domains]),
    ].filter((x): x is string => Boolean(x));
    for (const store of stores) {
      expect(storeLabel(store), store).not.toBe("Online store");
      expect(namesABrand(storeLabel(store)), store).toBeNull();
    }
    for (const d of STORE_DOMAINS) expect(namesABrand(storeLabel(d)), d).toBeNull();
    expect(storeLabel("cvs.com")).toBe("Pharmacy");
    expect(storeLabel("CVS Pharmacy")).toBe("Pharmacy");
    expect(storeLabel("https://www.ulta.com/p/x")).toBe("Beauty chain");
    expect(storeLabel("olehenriksen.com")).toBe("Brand site");
    expect(storeLabel("some-new-shop.com")).toBe("Online store");
    expect(storeLabel("cvs.com", "letters")).toBe("Store A");
    expect(storeLabel("ulta.com", "letters")).toBe("Store B");
    expect(storeLabel("some-new-shop.com", "letters")).toMatch(/^Store [O-Z]$/);
    expect(uniqueStoreLabels(["Department store", "Pharmacy", "Department store"])).toEqual(["Department store", "Pharmacy", "Department store 2"]);
  });

  it("has an unbranded copy of every sample post, with a neutral label and description, on disk", () => {
    for (const sample of SAMPLES) {
      const film = FILM_SAMPLES[sample.id];
      expect(film, sample.id).toBeDefined();
      expect(namesABrand(film.label)).toBeNull();
      expect(namesABrand(film.alt)).toBeNull();
      expect(productImage(`/samples/${sample.file}`)).toBe(film.image);
    }
    for (const image of FILM_IMAGES) expect(existsSync(join(process.cwd(), "public", image)), image).toBe(true);
    expect(productImage("https://cdn.example.com/x.jpg", "serum")).toBe("/filming/products/serum.png");
    expect(productImage("https://cdn.example.com/x.jpg", "toaster")).toBe("/filming/products/generic.png");
  });

  it("shows the sample week after a purchase, a drop and a decline with no brand, store, handle or card network left", () => {
    const raw = filmedWeek();
    const view = filmState(raw, { shortIds: true });
    for (const text of shownStrings(view)) expect(namesABrand(text), text).toBeNull();
    // The visible words are generic.
    const skip = view.checks.find((c) => c.id === "week-spf")!;
    expect(skip.facts.name).toBe("Oil-Free Face Sunscreen SPF 60");
    expect(skip.facts.brand).toBe("Skincare");
    expect(skip.reason.text).toContain("Face Sunscreen Milk SPF 60");
    expect(skip.decision.evidence.policy?.retailerName).toBe("Pharmacy");
    expect(skip.product?.imageUrl).toBe("/filming/posts/sunscreen.png");
    expect(view.methods[0].label).toBe("Card ending 1111");
    expect(view.receipts[0].methodLabel).toBe("Card ending 1111");
    expect(view.receipts[0].orderId).toBe("…15T");
    expect(view.notices.at(-1)!.text).toContain("PayPal order …15T");
    expect(view.notices.at(-1)!.ids![0].value).toBe("…15T");
  });

  it("changes only what is shown: ids, links, amounts, verdicts and policy facts stay the same", () => {
    const raw = filmedWeek();
    const before = JSON.stringify(raw);
    const view = filmState(raw);
    expect(JSON.stringify(raw)).toBe(before);
    const kept = (s: SessionState) => ({
      checks: s.checks.map((c) => ({ id: c.id, verdict: c.decision.verdict, rule: c.decision.rule, flags: c.decision.flags, price: c.facts.priceShown, band: c.band, policy: c.decision.evidence.policy && { ...c.decision.evidence.policy, retailerName: undefined, conditions: undefined }, sample: c.input, offers: c.offers })),
      receipts: s.receipts.map((r) => ({ id: r.id, amountCents: r.amountCents, orderId: r.orderId, requestId: r.requestId, approvalKey: r.approvalKey, status: r.status })),
      watch: s.watch.map((w) => ({ id: w.id, target: w.targetPrice, current: w.currentPrice, start: w.startPrice, offerUrl: w.product.offerUrl, offerDomain: w.product.offerDomain })),
      methods: s.methods.map((m) => ({ id: m.id, vaultId: m.vaultId, capCents: m.capCents })),
      shelf: s.shelf.map((i) => ({ id: i.id, runOutDate: i.runOutDate, price: i.price })),
      budgets: s.budgets,
      dayOffset: s.dayOffset,
    });
    expect(kept(view)).toEqual(kept(raw));
  });

  it("keeps a reason's structure, and the commission and sandbox wording, while naming things generically", () => {
    expect(neutralText("You already own La Roche-Posay Anthelios Melt-in Milk Sunscreen SPF 60, which does the same job, and CVS Pharmacy takes it back opened with a receipt.")).toBe(
      "You already own Face Sunscreen Milk SPF 60, which does the same job, and Pharmacy takes it back opened with a receipt.",
    );
    expect(neutralText("We may earn a commission when you buy through them.")).toBe("We may earn a commission when you buy through them.");
    expect(neutralText("PayPal sandbox: no real money moves.")).toBe("PayPal sandbox: no real money moves.");
    expect(neutralText("$45.36 is your target. Buy at or under the target.")).toBe("$45.36 is your target. Buy at or under the target.");
    expect(neutralText("Last bought at Target.")).toBe("Last bought at Big-box store.");
    expect(neutralText("@lucia.routine got it at Ulta")).toBe("@glowlist got it at Beauty chain");
    // A shelf item's name wins over a catalogue listing with the same brand and name.
    expect(neutralText("CeraVe Moisturizing Cream")).toBe("Moisturizing Cream");
    expect(neutralText("Maybelline Lash Sensational Washable Mascara")).toBe("Washable Mascara");
  });

  it("says card networks generically and shortens PayPal ids", () => {
    expect(neutralText("Visa ending 1111")).toBe("Card ending 1111");
    expect(neutralText("PayPal declined Mastercard ending 4444 for this rebuy.")).toBe("PayPal declined Card ending 4444 for this rebuy.");
    expect(namesABrand("Amex ending 1005")).toBe("Amex");
    expect(shortId("5O190127TN364715T")).toBe("…15T");
    expect(neutralText("PayPal order 5O190127TN364715T, capture 3C679366HH908993F.", { shortIds: true })).toBe("PayPal order …15T, capture …93F.");
    expect(neutralText("Event WH-2WR32451HC0233532-67976317FL4543714 verified.", { shortIds: true })).toBe("Event …714 verified.");
    // Without the option the ids stay whole (receipts in filming mode ask for it).
    expect(neutralText("PayPal order 5O190127TN364715T")).toBe("PayPal order 5O190127TN364715T");
    expect(neutralDeep({ orderId: "5O190127TN364715T", captureId: "3C679366HH908993F", id: "rc_1" }, { shortIds: true })).toEqual({ orderId: "…15T", captureId: "…93F", id: "rc_1" });
  });

  it("keeps the simulated-date label, said one short way", () => {
    expect(compactSimulated("Nov 19, 2026 (simulated date)")).toBe("Nov 19, 2026 (simulated)");
    expect(compactSimulated("9:41 PM ET, simulated date Fri, Nov 13")).toBe("9:41 PM ET, Fri, Nov 13 (simulated)");
    expect(compactSimulated("Card, counted on the simulated date Fri, Nov 13")).toBe("Card, counted on Fri, Nov 13 (simulated)");
    expect(compactSimulated("Runs out Jan 12 (counted from the simulated date Fri, Nov 13).")).toBe("Runs out Jan 12 (counted from Fri, Nov 13, simulated).");
    expect(compactSimulated("Simulated date")).toBe("Simulated date");
  });

  it("names the PayPal order's item generically, with the same amount and SKU", () => {
    const s = seedState("filmsession0003", TODAY, NOW);
    const staple = { kind: "staple" as const, shelfItemId: "sh-cleanser", cycle: s.shelf.find((i) => i.id === "sh-cleanser")!.runOutDate! };
    const d = sourceDetails(s, staple);
    const intent = { id: "in_1", createdAt: NOW.toISOString(), source: staple, title: d.title, brand: d.brand, category: d.category, amountCents: d.amountCents, currency: "USD", productId: d.productId };
    const opts = { funding: "card" as const, save: true, customerId: "slfilm", returnUrl: "http://x/", cancelUrl: "http://x/" };
    const real = checkoutOrderBody(intent, opts, intent.productId);
    const film = checkoutOrderBody({ ...intent, title: productName({ brand: intent.brand, name: intent.title, id: intent.productId, category: intent.category }) }, opts, intent.productId);
    const item = (b: typeof real) => (b.purchase_units[0] as unknown as { items: Array<{ name: string; sku: string; unit_amount: unknown }>; amount: unknown }).items[0];
    expect(item(film).name).toBe("Hydrating Cleanser");
    expect(namesABrand(JSON.stringify(film))).toBeNull();
    expect(item(film).sku).toBe(item(real).sku);
    expect(item(film).unit_amount).toEqual(item(real).unit_amount);
    expect((film.purchase_units[0] as { amount: unknown }).amount).toEqual((real.purchase_units[0] as { amount: unknown }).amount);
  });

  it("shows the landing sample generically", () => {
    const x = landingSample(true);
    for (const text of shownStrings({ ...x, check: undefined })) expect(namesABrand(text), text).toBeNull();
    expect(x.imageUrl).toMatch(/^\/filming\//);
    expect(landingSample(false).brand).toBe("La Roche-Posay");
  });

  it("finds a brand in a page's visible text but not in its links", () => {
    const html = `<html><head><script>self.x="CeraVe"</script><style>.a{}</style></head><body><a href="https://www.cvs.com/p" rel="noreferrer sponsored">Pharmacy</a><img src="/filming/posts/sunscreen.png" alt="A post"><p>Face Sunscreen Milk SPF 60</p></body></html>`;
    expect(namesABrand(visibleText(html))).toBeNull();
    expect(namesABrand(visibleText(html.replace("A post", "A CeraVe post")))).toBe("CeraVe");
    expect(namesABrand(visibleText(html.replace("<p>Face", "<p>CVS Face")))).toBe("CVS");
  });
});

describe("filming mode on the framed pages, Decisions and the share flow", () => {
  it("shows the Decisions tables (shelf table, Needs your yes, price watches, verdicts) generically, as /api/state sends them", () => {
    const raw = filmedWeek();
    const real = studioPayload(raw, TODAY);
    const shown = neutralDeep(real, { shortIds: true });
    for (const text of shownStrings(shown)) expect(namesABrand(text), text).toBeNull();
    // The real tables do name things, so the check above means something.
    expect(shownStrings(real).some((t) => namesABrand(t))).toBe(true);
    const rebuy = shown.tables.rebuys.find((r) => r.id === "staple:sh-cleanser" || String(r.id).startsWith("watch:"));
    expect(rebuy).toBeDefined();
    expect(shown.tables.shelf.find((r) => r.id === "sh-cleanser")?.product).toBe("Hydrating Cleanser");
    // Amounts, dates and days left are the real ones.
    expect(shown.tables.shelf.map((r) => [r.id, r.runOutDate, r.daysLeft, r.price])).toEqual(real.tables.shelf.map((r) => [r.id, r.runOutDate, r.daysLeft, r.price]));
    expect(shown.budget).toEqual(real.budget);
  });

  it("words the verdict and checkout context column generically: returns line, store policy and the shelf item it matched", () => {
    const raw = filmedWeek();
    const view = filmState(raw);
    let lines = 0;
    for (const c of view.checks) {
      const store = c.decision.evidence.policy && !c.decision.evidence.policy.fallback ? c.decision.evidence.policy.retailerName : c.store;
      const r = returnsLine(c.decision, store);
      if (r) {
        lines++;
        expect(namesABrand(r.text), r.text).toBeNull();
      }
      const link = shelfLink(c, view.shelf);
      if (link) for (const t of [link.brand, link.name, link.label, link.note]) expect(namesABrand(t), t).toBeNull();
    }
    expect(lines).toBeGreaterThan(0);
    const skip = raw.checks.find((c) => c.id === "week-spf")!;
    expect(returnsLine(skip.decision, skip.decision.evidence.policy?.retailerName)?.text).toMatch(/^CVS/);
    expect(returnsLine(view.checks.find((c) => c.id === "week-spf")!.decision, "Pharmacy")?.text).toMatch(/^Pharmacy/);
  });

  it("keeps the rebuy shelf links and the payments agreement generic", () => {
    const view = filmState(filmedWeek(), { shortIds: true });
    for (const item of view.shelf) for (const t of [item.brand, item.name, item.store ?? ""]) expect(namesABrand(t), t).toBeNull();
    for (const m of view.methods) for (const t of [m.label, m.consentText]) expect(namesABrand(t), t).toBeNull();
  });

  it("names nothing in the share flow's messages, and a shared /check still shows the unbranded sample posts", () => {
    for (const message of Object.values(SHARE_ERRORS)) expect(namesABrand(message), message).toBeNull();
    for (const link of ["javascript:alert(1)", "not a link", `https://www.ulta.com/${"x".repeat(2100)}`]) {
      const v = validateSharedLink(link);
      expect("error" in v && namesABrand(v.error)).toBeFalsy();
    }
    for (const q of [{ share_error: "type" }, { share_error: "nope" }, { text: "no link here" }, { shared: "bad" }]) {
      const v = sharedInput(q);
      expect(v?.kind).toBe("error");
      expect(namesABrand(v && v.kind === "error" ? v.message : "")).toBeNull();
    }
    // The /check page hands the share to the same intake in both modes, with the film copies of the posts in filming mode.
    const page = readFileSync(join(process.cwd(), "app/check/page.tsx"), "utf8");
    expect(page).toMatch(/film \? <Intake samples=\{SAMPLES\.map\(\(x\) => \(\{ \.\.\.x, \.\.\.FILM_SAMPLES\[x\.id\] \}\)\)\} shared=\{shared\}/);
    expect(page).toContain("<Intake samples={SAMPLES} shared={shared} />");
    // The intake's fallback while the share is read is a blank card, never the real posts.
    expect(page).not.toContain("fallback={<Intake");
  });
});
