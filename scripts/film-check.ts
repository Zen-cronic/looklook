/**
 * Checks a running server in filming mode: loads the sample week in a fresh
 * session, opens the main pages with ?film=1, and fails if any page's visible
 * text (or an image's alt) names a known brand, product line, store, creator
 * handle or card network, or shows a product image that isn't an unbranded
 * stand-in. Covers the checkout for a buy verdict and the pages a phone's
 * share sheet opens (a shared link, a shared screenshot's token, a share
 * error). Then checks the same pages without the switch still show the real
 * names, so the mode stays off by default.
 *
 *   npm run film:check -- http://localhost:3200
 */
import { namesABrand } from "../lib/filming/neutral";
import { visibleText } from "../lib/filming/visible";

const base = (process.argv[2] ?? "http://localhost:3200").replace(/\/$/, "");

async function main() {
  const first = await fetch(`${base}/judge`, { redirect: "manual" });
  const session = first.headers.getSetCookie().find((c) => c.startsWith("sl_session="))?.split(";")[0];
  if (!session) throw new Error("no session cookie from the server");
  const plain = { cookie: session };
  const film = { cookie: `${session}; ll_film=1` };

  const load = await fetch(`${base}/api/demo`, { method: "POST", headers: { ...plain, "content-type": "application/json" }, body: JSON.stringify({ action: "sample-week" }) });
  if (!load.ok) throw new Error(`loading the sample week failed: ${load.status}`);
  const state = (await (await fetch(`${base}/api/state`, { headers: plain })).json()) as { checks: Array<{ id: string; decision: { verdict: string } }>; receipts: Array<{ id: string }> };

  // A checkout for the first buy verdict (no PayPal call until the buttons are used).
  const buy = state.checks.find((c) => c.decision.verdict === "buy");
  const checkout: string[] = [];
  if (buy) {
    const res = await fetch(`${base}/api/intents`, { method: "POST", headers: { ...plain, "content-type": "application/json" }, body: JSON.stringify({ source: { kind: "check", checkId: buy.id } }) });
    const intent = (await res.json()) as { id?: string };
    if (intent.id) checkout.push(`/checkout/${intent.id}`);
  }
  if (!checkout.length) throw new Error("couldn't open a checkout for a buy verdict");

  // What a phone's share sheet opens; the page clears the query and checks in the browser.
  const share = ["/check?url=https%3A%2F%2Fwww.ulta.com%2Fp%2Fexample", "/check?text=Look%20https%3A%2F%2Fwww.sephora.com%2Fproduct%2Fexample", "/check?shared=aaaaaaaaaaaaaaaaaaaaaaaa.zz.bb", "/check?share_error=type", "/check?share_error=heif", "/share"];

  // A week handed over (the sample week's posts): its page and its JSON.
  const weekRes = await fetch(`${base}/api/week`, { method: "POST", headers: { ...plain, "content-type": "application/json" }, body: JSON.stringify({ checkIds: ["week-spf", "week-vitc", "week-retinol", "week-peptide"] }) });
  const weekId = ((await weekRes.json()) as { id?: string }).id;
  if (!weekId) throw new Error(`couldn't hand over the sample week (${weekRes.status})`);
  const week = ["/week", `/week?run=${weekId}`];

  const pages = ["/", "/check", ...share, ...week, ...state.checks.map((c) => `/check/${c.id}`), ...checkout, "/shelf", "/rebuys", "/payments", "/events", "/proof", "/judge", "/studio", ...state.receipts.map((r) => `/receipts/${r.id}`)];
  const problems: string[] = [];
  for (const path of pages) {
    const html = await (await fetch(`${base}${path}${path.includes("?") ? "&" : "?"}film=1`, { headers: film })).text();
    const hit = namesABrand(visibleText(html));
    if (hit) problems.push(`${path}: shows "${hit}"`);
    for (const m of html.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g)) {
      if (!/^(\/filming\/|\/media\/|\/_next\/|data:)/.test(m[1])) problems.push(`${path}: image ${m[1]}`);
    }
  }
  const stateJson = await (await fetch(`${base}/api/state`, { headers: film })).text();
  const shown = stateJson.replace(/"[A-Za-z]*(Url|url|href)":"[^"]*"/g, "").replace(/"(domain|offerDomain|sample|id|productId|approvalKey|sourceRef)":"[^"]*"/g, "");
  const stateHit = namesABrand(shown);
  if (stateHit) problems.push(`/api/state: shows "${stateHit}"`);
  const weekJson = await (await fetch(`${base}/api/week/${weekId}`, { headers: film })).text();
  const weekHit = namesABrand(weekJson.replace(/"[A-Za-z]*(Url|url|href)":"[^"]*"/g, "").replace(/"(id|checkId|productId|approvalKey|shelfItemId|hash)":"[^"]*"/g, ""));
  if (weekHit) problems.push(`/api/week: shows "${weekHit}"`);

  // Off by default: the same session without the switch shows the real names.
  for (const path of ["/check/week-spf", `/week?run=${weekId}`, ...checkout]) {
    const real = visibleText(await (await fetch(`${base}${path}`, { headers: plain })).text());
    if (!namesABrand(real)) problems.push(`${path} without ?film=1 shows no real names: the mode looks on by default`);
  }

  console.log(`${pages.length} pages, /api/state and /api/week checked in filming mode`);
  if (problems.length) {
    console.log(problems.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("no brand, store, handle or card network in view; real names without the switch");
  }
}

void main();
