import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAYPAL_API_BASE } from "./config";
import { SDK_V6_SCRIPT_URL, paymentFlow, sdkFits, submitOutcome, wantsSdkV6 } from "./sdk-v6";

describe("PayPal JS SDK v6 helpers", () => {
  it("loads the v6 core script from the sandbox, like the API base", () => {
    expect(SDK_V6_SCRIPT_URL).toBe("https://www.sandbox.paypal.com/web-sdk/v6/core");
    expect(PAYPAL_API_BASE).toContain("sandbox");
  });

  it("checks eligibility for saving during the purchase only when the save box is ticked", () => {
    expect(paymentFlow(true)).toBe("VAULT_WITH_PAYMENT");
    expect(paymentFlow(false)).toBe("ONE_TIME_PAYMENT");
  });

  it("captures only when Card Fields says succeeded", () => {
    expect(submitOutcome({ state: "succeeded", data: { orderId: "O1" } }, "O0")).toEqual({ kind: "capture", orderId: "O1" });
    expect(submitOutcome({ state: "succeeded" }, "O0")).toEqual({ kind: "capture", orderId: "O0" });
    expect(submitOutcome({ state: "canceled" }, "O0")).toEqual({ kind: "retry", message: "Card verification was closed. Nothing was charged." });
    expect(submitOutcome({ state: "failed", data: { message: "x" } }, "O0").kind).toBe("retry");
    expect(submitOutcome(undefined, "O0").kind).toBe("retry");
  });
});

describe("checkout SDK selection", () => {
  it("uses v6 only with ?sdk=v6", () => {
    expect(wantsSdkV6({})).toBe(false);
    expect(wantsSdkV6({ sdk: "v5" })).toBe(false);
    expect(wantsSdkV6({ sdk: "v6" })).toBe(true);
    expect(wantsSdkV6({ sdk: ["v6", "v5"] })).toBe(true);
    expect(wantsSdkV6({ sdk: "v6", env: "1" })).toBe(true);
  });

  it("PAYPAL_SDK_V6=0 forces v5", () => {
    expect(wantsSdkV6({ sdk: "v6", env: "0" })).toBe(false);
  });

  it("filming mode uses v5 unless ?sdk=v6 asks for v6", () => {
    expect(wantsSdkV6({ film: true })).toBe(false);
    expect(wantsSdkV6({ sdk: "v5", film: true })).toBe(false);
    expect(wantsSdkV6({ sdk: "v6", film: true })).toBe(true);
    expect(wantsSdkV6({ sdk: "v6", film: true, env: "0" })).toBe(false);
  });

  it("the checkout page picks the panel through wantsSdkV6 and keeps v5 as the other branch", () => {
    const page = readFileSync(new URL("../../app/checkout/[id]/page.tsx", import.meta.url), "utf8");
    expect(page).toMatch(/wantsSdkV6\(\{ sdk: \(await searchParams\)\.sdk, env: process\.env\.PAYPAL_SDK_V6, film \}\)/);
    expect(page).toMatch(/v6 \? \(\s*<CheckoutPanelV6 [^]*?\) : \(\s*<CheckoutPanel /);
  });
});

describe("window.paypal guard", () => {
  const v5 = { Buttons: () => ({}), FUNDING: { PAYPAL: "paypal" } };
  const v6 = { createInstance: async () => ({}) };

  it("v5 reuses window.paypal only when it has Buttons", () => {
    expect(sdkFits(v5, "v5")).toBe(true);
    expect(sdkFits(v6, "v5")).toBe(false);
    expect(sdkFits(undefined, "v5")).toBe(false);
  });

  it("v6 reuses window.paypal only when it has createInstance", () => {
    expect(sdkFits(v6, "v6")).toBe(true);
    expect(sdkFits(v5, "v6")).toBe(false);
    expect(sdkFits(null, "v6")).toBe(false);
  });

  it("the v5 panel's loader goes through the guard", () => {
    const panel = readFileSync(new URL("../../app/components/CheckoutPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain('if (window.paypal && sdkFits(window.paypal, "v5")) return Promise.resolve(window.paypal);');
  });
});
