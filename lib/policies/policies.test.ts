import { describe, expect, it } from "vitest";
import { findRetailer, openedReturnPolicy, parsePolicyTable, policyTable, PolicyTableError } from "./index";

describe("return-policy table", () => {
  it("loads the shipped table with the seven stores", () => {
    const t = policyTable();
    expect(t.retailers.map((r) => r.id)).toEqual(["sephora", "ulta", "target", "cvs", "walgreens", "kohls", "brand-site"]);
  });

  it("gives every known answer a source URL and a check date", () => {
    for (const r of policyTable().retailers) {
      for (const rule of r.rules) {
        expect(rule.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        if (rule.returnableOpened !== "unknown") expect(rule.sourceUrl).toMatch(/^https:\/\//);
      }
    }
  });

  it("keeps quotes short", () => {
    for (const r of policyTable().retailers) {
      for (const rule of r.rules) {
        for (const quote of rule.conditions.match(/"[^"]*"/g) ?? []) expect(quote.split(/\s+/).length).toBeLessThanOrEqual(8);
      }
    }
  });

  it("finds stores by id, name, domain and URL", () => {
    expect(findRetailer("cvs").id).toBe("cvs");
    expect(findRetailer("Ulta Beauty").id).toBe("ulta");
    expect(findRetailer("www.target.com").id).toBe("target");
    expect(findRetailer("https://es.cvs.com/shop/x").id).toBe("cvs");
    expect(findRetailer("dermstore.com").id).toBe("brand-site");
    expect(findRetailer(undefined).id).toBe("brand-site");
  });

  it("picks the rule for the item's group and falls back to general", () => {
    expect(openedReturnPolicy("target", "serum").returnableOpened).toBe("yes");
    expect(openedReturnPolicy("target", "headphones").returnableOpened).toBe("conditional");
    const blender = openedReturnPolicy("target", "blender");
    expect(blender.group).toBe("general");
    expect(blender.returnableOpened).toBe("no");
    expect(blender.fallback).toBe(false);
    const sephoraBlender = openedReturnPolicy("sephora", "blender");
    expect(sephoraBlender.returnableOpened).toBe("unknown");
    expect(sephoraBlender.fallback).toBe(true);
  });

  it("marks unknown stores as unknown, never returnable", () => {
    const p = openedReturnPolicy("lancome-usa.com", "moisturizer");
    expect(p.retailerId).toBe("brand-site");
    expect(p.returnableOpened).toBe("unknown");
    expect(p.fallback).toBe(true);
  });

  it("rejects a table with a sourceless answer or a bad value", () => {
    const base = { checkedOn: "2026-11-06", retailers: [{ id: "brand-site", domains: [], policyUrl: null, rules: [{ group: "general", returnableOpened: "unknown", windowDays: null, conditions: "", sourceUrl: null, checkedOn: "2026-11-06" }] }] };
    expect(() => parsePolicyTable(base)).not.toThrow();
    const noSource = structuredClone(base);
    noSource.retailers[0].rules[0].returnableOpened = "yes";
    expect(() => parsePolicyTable(noSource)).toThrow(PolicyTableError);
    const bad = structuredClone(base);
    bad.retailers[0].rules[0].returnableOpened = "maybe";
    expect(() => parsePolicyTable(bad)).toThrow(PolicyTableError);
    expect(() => parsePolicyTable({ checkedOn: "2026-11-06", retailers: [] })).toThrow(/fallback/);
  });
});
