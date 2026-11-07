import { describe, expect, it } from "vitest";
import { findRetailer, openedNeedsFor, openedReturnPolicy, parsePolicyTable, policyTable, PolicyTableError } from "./index";

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

  it("takes opened beauty back at CVS with a receipt, citing the beauty section of its policy page", () => {
    for (const category of ["sunscreen", "serum", "lipstick", "mascara"] as const) {
      const p = openedReturnPolicy("cvs", category);
      expect(p).toMatchObject({ retailerId: "cvs", group: "beauty", returnableOpened: "yes", windowDays: 60, openedNeeds: "with a receipt", fallback: false });
      expect(p.sourceUrl).toMatch(/^https:\/\/www\.cvs\.com\/retail\/help\/return_policy#/);
      expect(p.conditions).toMatch(/third-party return authorization/);
    }
    expect(openedNeedsFor("cvs", "beauty")).toBe("with a receipt");
    // Everything else at CVS still follows the general returns PDF.
    const kettle = openedReturnPolicy("cvs.com", "blender");
    expect(kettle).toMatchObject({ group: "general", returnableOpened: "no", windowDays: 60 });
    expect(kettle.sourceUrl).toMatch(/returns\.pdf$/);
  });

  it("rejects an empty opened-return condition", () => {
    const t = JSON.parse(JSON.stringify(policyTable()));
    t.retailers[0].rules[0].openedNeeds = " ";
    expect(() => parsePolicyTable(t)).toThrow(PolicyTableError);
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
    // Opened electronics aren't on Target's exchange-only list, so its general rule applies.
    expect(openedReturnPolicy("target", "headphones").returnableOpened).toBe("no");
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
