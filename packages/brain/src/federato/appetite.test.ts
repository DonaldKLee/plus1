import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scorePolicyAppetite,
  scorePremium,
  scoreTiv,
  scoreLineOfBusiness,
} from "./appetite.ts";

test("property LOB is acceptable; cyber is not", () => {
  assert.equal(scoreLineOfBusiness("property").tier, "acceptable");
  assert.equal(scoreLineOfBusiness("cyber").tier, "not_acceptable");
});

test("premium target band", () => {
  assert.equal(scorePremium(85_000).tier, "target");
  assert.equal(scorePremium(619_900).tier, "not_acceptable");
});

test("TIV bands", () => {
  assert.equal(scoreTiv(75_000_000).tier, "target");
  assert.equal(scoreTiv(160_000_000).tier, "not_acceptable");
});

test("Harbor Point-like account declines", () => {
  const r = scorePolicyAppetite({
    accountName: "Harbor Point Retail LLC",
    lineOfBusiness: "property",
    businessType: "new",
    premium: 619_900,
    lossTotal: 1_500_000,
    locations: [
      {
        state: "FL",
        tiv: 36_710_000,
        buildings: [
          { tiv: 31_614_000, yearBuilt: 2011, constructionType: "Frame" },
          { tiv: 2_321_000, yearBuilt: 1954, constructionType: "Frame" },
        ],
      },
      {
        state: "AZ",
        tiv: 19_344_000,
        buildings: [
          { tiv: 18_446_000, yearBuilt: 1984, constructionType: "Non-Combustible" },
        ],
      },
      {
        state: "WA",
        tiv: 29_104_000,
        buildings: [
          { tiv: 14_002_000, yearBuilt: 1997, constructionType: "Fire Resistive" },
        ],
      },
    ],
  });
  assert.ok(r.decision === "decline" || r.decision === "refer");
  assert.ok(r.factors.some((f) => f.factor === "total_premium" && f.tier === "not_acceptable"));
  assert.ok(r.factors.some((f) => f.factor === "multi_state_exposure"));
});
