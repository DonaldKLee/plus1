import { test } from "node:test";
import assert from "node:assert/strict";
import { submissionIntakeInput, intakeRequests } from "./intake.js";
import { scorePolicyAppetite } from "./appetite.js";

const priorPolicy = {
  id: 9, line_of_business: "property", business_type: "new", premium: 90_000, dates: { effective: "2024-10-01" },
  insured: { id: 7, name: "Willowbrook Stores Inc" },
  claims: [{ paid_indemnity: 20_000, paid_expense: 0, reserve_indemnity: 0, reserve_expense: 0 }],
  exposure_units: [{ basis_amount: 60_000_000, location: { id: 41, state: "OH", zip: "43215", county: "Franklin", address: "1 Main St", buildings: [{ tiv: 60_000_000, year_built: 2012, construction_type: "Steel" }] } }],
};

test("a returning insured is a renewal with exposure recovered from history; premium goes on the request list", () => {
  const sub = { id: 134, submission_number: "SUB-2025-00134", status: "quoted", line_of_business: "property", requested_limit: 1_000_000, insured: { id: 7, name: "Willowbrook Stores Inc" }, broker: { name: "Pacific Coast" } };
  const { input, basis, businessType } = submissionIntakeInput(sub, [priorPolicy]);
  assert.equal(businessType, "renewal");
  assert.equal(input.locations.length, 1);
  assert.equal(input.lossTotal, 20_000);
  assert.equal(input.premium, null);
  assert.match(basis.note, /1 location from 1 prior policy; 1 claim in the last 5 years on 1 property policy/);
  const r = scorePolicyAppetite(input);
  assert.ok(r.factors.some((f) => f.factor === "total_premium" && f.tier === "missing"));
  assert.ok(r.factors.some((f) => f.factor === "submission_type" && f.tier === "not_acceptable"));
  assert.deepEqual(intakeRequests(r.factors, basis), ["premium indication / target premium"]);
});

test("a brand-new insured is new business with everything missing → investigate + full request list", () => {
  const sub = { id: 1, submission_number: "SUB-1", status: "received", line_of_business: "property", insured: { id: 99, name: "Fresh Co" } };
  const { input, basis, businessType } = submissionIntakeInput(sub, []);
  assert.equal(businessType, "new");
  assert.equal(input.lossTotal, null);
  const r = scorePolicyAppetite(input);
  assert.equal(r.decision, "investigate");
  const reqs = intakeRequests(r.factors, basis);
  assert.ok(reqs.includes("statement of values (locations, TIV)"));
  assert.ok(reqs.includes("five-year currently valued loss runs"));
  assert.ok(reqs.includes("premium indication / target premium"));
});

test("prior policies in a different line make it new business but still supply exposure", () => {
  const sub = { id: 2, line_of_business: "property", insured: { id: 7, name: "Willowbrook Stores Inc" } };
  const cgl = { ...priorPolicy, id: 10, line_of_business: "cgl" };
  const { input, businessType, basis } = submissionIntakeInput(sub, [cgl]);
  assert.equal(businessType, "new");
  assert.equal(input.locations.length, 1);
  assert.equal(basis.priorSameLine, 0);
});
