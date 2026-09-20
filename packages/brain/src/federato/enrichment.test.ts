import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreEnrichment, describeEnrichment, type HazardEnrichment } from "./enrichment.js";
import { scorePolicyAppetite, scoreBusinessType } from "./appetite.js";

const tampa: HazardEnrichment = {
  zip: "33602", county: "Hillsborough", state: "FL",
  declarationsSince2015: 21, declarationTypes: { Hurricane: 12, "Severe Storm": 5 },
  nfipClaims: 340, maxDailyPrecipMm: 226, maxGustKmh: 153, hotDays: 40, quakesSince2000: 0,
  nri: { riskScore: 98, riskRating: "Very High", expectedAnnualLossRating: "Very High", perils: { hurricane: "Very High", coastal_flood: "Relatively High" } },
  geocode: { county: "Hillsborough County", state: "Florida", matchesFile: true },
  sources: ["openfema", "nfip", "open-meteo", "usgs", "nri", "osm"],
};
const columbus: HazardEnrichment = {
  zip: "43215", county: "Franklin", state: "OH",
  declarationsSince2015: 2, declarationTypes: { Biological: 1, "Severe Storm": 1 },
  nfipClaims: 12, maxDailyPrecipMm: 60, maxGustKmh: 95, hotDays: 2, quakesSince2000: 0,
  nri: { riskScore: 30, riskRating: "Relatively Low", expectedAnnualLossRating: "Relatively Low", perils: { tornado: "Relatively Moderate" } },
  geocode: { county: "Franklin County", state: "Ohio", matchesFile: true },
  sources: ["openfema", "nfip", "open-meteo", "usgs", "nri", "osm"],
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
  assert.equal(bad.find((f) => f.factor === "fema_national_risk_index")!.tier, "not_acceptable");
  const good = scoreEnrichment(columbus);
  assert.ok(good.every((f) => f.points >= 1));
  assert.equal(good.find((f) => f.factor === "fema_national_risk_index")!.tier, "target");
});

test("lookup failures score as missing, never as a fail", () => {
  const none: HazardEnrichment = { ...columbus, declarationsSince2015: null, nfipClaims: null, maxGustKmh: null, maxDailyPrecipMm: null, quakesSince2000: null, nri: null, geocode: null, sources: [] };
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

test("quakes and a geocode mismatch are flagged with stated rules", () => {
  const seattle: HazardEnrichment = { ...columbus, quakesSince2000: 8, geocode: { county: "King County", state: "Washington", matchesFile: false } };
  const f = scoreEnrichment(seattle);
  assert.equal(f.find((x) => x.factor === "usgs_earthquakes")!.points, 0);
  assert.match(f.find((x) => x.factor === "location_consistency")!.value, /differs from the file/);
});
