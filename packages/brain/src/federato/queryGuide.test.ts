import { test } from "node:test";
import assert from "node:assert/strict";
import { compactSchema, validateQueryPayload, collapseGroups } from "./queryGuide.js";
import type { FederatoSchema } from "./queryPlan.js";

const schema: FederatoSchema = {
  Policy: { type: "object", fields: {
    id: { type: "number" }, premium: { type: "number" }, line_of_business: { type: "string" },
    insured: { type: "reference", resource: "Insured", cardinality: "one" },
    exposure_units: { type: "reference", resource: "ExposureUnit", cardinality: "many" },
    producer: { type: "object", fields: { broker: { type: "reference", resource: "Broker", cardinality: "one" }, contact: { type: "reference", resource: "Contact", cardinality: "one" } } },
  } },
  Insured: { type: "object", fields: { id: { type: "number" }, name: { type: "string" } } },
  ExposureUnit: { type: "object", fields: { id: { type: "number" }, location: { type: "reference", resource: "Location", cardinality: "one" } } },
  Location: { type: "object", fields: { id: { type: "number" }, state: { type: "string" }, hazard_tags: { type: "array", itemSchema: { type: "string" } } } },
  Broker: { type: "object", fields: { id: { type: "number" }, name: { type: "string" } } },
  Contact: { type: "object", fields: { id: { type: "number" } } },
};

test("compactSchema is one line per resource with reference arrows", () => {
  const s = compactSchema(schema);
  assert.match(s, /^Policy: id:number, premium:number, line_of_business:string, insured:→Insured, exposure_units:→ExposureUnit\[\], producer:\{broker,contact\}/m);
  assert.match(s, /hazard_tags:\[string\]/);
});

test("valid query passes", () => {
  const v = validateQueryPayload({ resource: "Policy", where: { line_of_business: "property", premium: { $gte: 50000 } }, expand: { insured: true, exposure_units: { location: true } }, filter: { exposure_units: { $elemMatch: { location: { state: "CA" } } } }, select: ["id", "premium"], pagination: { limit: 10 } }, schema);
  assert.deepEqual(v.problems, []);
  assert.ok(v.ok);
});

test("catches the classic mistakes", () => {
  assert.match(validateQueryPayload({ resource: "Polcy" }, schema).problems[0]!, /resource must be one of/);
  assert.match(validateQueryPayload({ resource: "Policy", where: { "insured.name": "x" } }, schema).problems.join(" "), /reference "insured"; expand it and use "filter"/);
  assert.match(validateQueryPayload({ resource: "Policy", where: { "exposure_units.location.state": "CA" } }, schema).problems.join(" "), /\$elemMatch/);
  assert.match(validateQueryPayload({ resource: "Policy", expand: { premium: true } }, schema).problems.join(" "), /not a reference/);
  assert.match(validateQueryPayload({ resource: "Policy", expand: { producer: { broker: true } } }, schema).problems.join(" "), /^$/);
  assert.match(validateQueryPayload({ resource: "Policy", wher: {} }, schema).problems.join(" "), /unknown top-level key/);
});

test("select object values must not be path strings; over keys should be selected", () => {
  const v = validateQueryPayload({ resource: "Policy", select: { broker: "producer.broker.name", n: { $count: true } } }, schema);
  assert.match(v.problems.join(" "), /is a string/);
  const w = validateQueryPayload({ resource: "Policy", over: ["line_of_business"], select: { n: { $count: true } } }, schema);
  assert.ok(w.ok);
  assert.match(w.warnings.join(" "), /not in select/);
});

test("collapseGroups turns per-record rows into groups", () => {
  const rows = [
    { cause: "fire", n: 1, paid: 100, big: 100 },
    { cause: "fire", n: 1, paid: 50, big: 50 },
    { cause: "theft", n: 1, paid: 10, big: 10 },
  ];
  const { rows: out, collapsed } = collapseGroups(rows, { cause: true, n: { $count: true }, paid: { $sum: "paid" }, big: { $max: "paid" } });
  assert.ok(collapsed);
  assert.deepEqual(out, [{ cause: "fire", n: 2, paid: 150, big: 100 }, { cause: "theft", n: 1, paid: 10, big: 10 }]);
  assert.equal(collapseGroups(rows, ["cause"]).collapsed, false);
});

test("bogus aggregation operators are caught before sending", () => {
  const v = validateQueryPayload({ resource: "Policy", select: { n: { "%count": true } } }, schema);
  assert.match(v.problems.join(" "), /unknown aggregation "%count"/);
});
