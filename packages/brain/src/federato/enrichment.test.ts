import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreEnrichment, describeEnrichment, type HazardEnrichment } from "./enrichment.js";
import { scorePolicyAppetite, scoreBusinessType } from "./appetite.js";

const tampa: HazardEnrichment = {
  zip: "33602", county: "Hillsborough", state: "FL",
  declarationsSince2015: 21, declarationTypes: { Hurricane: 12, "Severe Storm": 5 },
  nfipClaims: 340, maxDailyPrecipMm: 226, maxGustKmh: 153, sources: ["openfema", "nfip", "open-meteo"],
};
const columbus: HazardEnrichment = {
  zip: "43215", county: "Franklin", state: "OH",
  declarationsSince2015: 2, declarationTypes: { Biological: 1, "Severe Storm": 1 },
  nfipClaims: 12, maxDailyPrecipMm: 60, maxGustKmh: 95, sources: ["openfema", "nfip", "open-meteo"],
};

test("renewal business is Not Acceptable per the 2025 table; new is Acceptable", () => {
  assert.equal(scoreBusinessType("renewal").tier, "not_acceptable");
  assert.equal(scoreBusinessType("new").tier, "acceptable");
});

test("cat-exposed county fails FEMA and NFIP factors; benign county earns credit", () => {
  const bad = scoreEnrichment(tampa);
  assert.equal(bad.find((f) => f.factor === "fema_declarations")!.tier, "not_acceptable");
  assert.equal(bad.find((f) => f.factor === "nfip_flood_claims")!.tier, "not_acceptable");
  assert.equal(bad.find((f) => f.factor === "weather_extremes")!.points, 0);
  const good = scoreEnrichment(columbus);
  assert.ok(good.every((f) => f.tier === "acceptable" && f.points === 1));
});

test("lookup failures score as missing, never as a fail", () => {
  const none: HazardEnrichment = { ...columbus, declarationsSince2015: null, nfipClaims: null, maxGustKmh: null, maxDailyPrecipMm: null, sources: [] };
  assert.ok(scoreEnrichment(none).every((f) => f.tier === "missing" && f.points === 0));
  assert.match(describeEnrichment(none), /no external risk data/);
});

test("enrichment visibly changes a borderline decision", () => {
  const input = {
    accountName: "Borderline Co",
    lineOfBusiness: "property",
    businessType: "new",
    premium: 90_000,
    lossTotal: 20_000,
    locations: [{ state: "FL", tiv: 60_000_000, zip: "33602", buildings: [{ tiv: 60_000_000, yearBuilt: 2015, constructionType: "Steel" }] }],
  };
  const base = scorePolicyAppetite(input);
  const enriched = scorePolicyAppetite(input, { enrichment: tampa });
  assert.equal(base.decision, "quote");
  assert.ok(enriched.score < base.score);
  assert.notEqual(enriched.decision, "quote");
  assert.ok(enriched.factors.some((f) => f.factor === "fema_declarations"));
});
