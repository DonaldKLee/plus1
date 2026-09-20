import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteCar, quoteTenant } from "./quote.ts";

test("calibrates to the ON provincial average (~$2068/yr)", () => {
  const q = quoteCar({ province: "ON", driverAge: 35, yearsLicensed: 15 });
  assert.ok(q.payment.annual > 1850 && q.payment.annual < 2300, `got ${q.payment.annual}`);
});

test("at-fault raises the premium; not-at-fault does not", () => {
  const clean = quoteCar({ province: "ON", driverAge: 30, yearsLicensed: 10 });
  const atFault = quoteCar({ province: "ON", driverAge: 30, yearsLicensed: 10, accidents: { atFault: 1, notAtFault: 0, lastAtFaultYearsAgo: 1 } });
  const notAtFault = quoteCar({ province: "ON", driverAge: 30, yearsLicensed: 10, accidents: { atFault: 0, notAtFault: 2 } });
  assert.ok(atFault.payment.annual > clean.payment.annual, "at-fault should raise");
  assert.equal(notAtFault.payment.annual, clean.payment.annual, "not-at-fault should be neutral");
});

test("accident forgiveness waives the first at-fault", () => {
  const surcharged = quoteCar({ province: "ON", driverAge: 30, yearsLicensed: 10, accidents: { atFault: 1, notAtFault: 0, lastAtFaultYearsAgo: 1 } });
  const forgiven = quoteCar({ province: "ON", driverAge: 30, yearsLicensed: 10, accidents: { atFault: 1, notAtFault: 0, lastAtFaultYearsAgo: 1 }, accidentForgiveness: true });
  assert.ok(forgiven.payment.annual < surcharged.payment.annual, "forgiveness should lower it");
});

test("recency: an old at-fault matters less than a recent one", () => {
  const recent = quoteCar({ province: "ON", accidents: { atFault: 1, notAtFault: 0, lastAtFaultYearsAgo: 1 } });
  const old = quoteCar({ province: "ON", accidents: { atFault: 1, notAtFault: 0, lastAtFaultYearsAgo: 8 } });
  assert.ok(recent.payment.annual > old.payment.annual, "recent should cost more");
});

test("appetite: two recent at-fault → high_risk; major conviction → high_risk", () => {
  const two = quoteCar({ province: "ON", accidents: { atFault: 2, notAtFault: 0, lastAtFaultYearsAgo: 2 } });
  assert.equal(two.appetite, "high_risk");
  assert.ok(two.handoffReason);
  const dui = quoteCar({ province: "ON", majorConvictions: 1 });
  assert.equal(dui.appetite, "high_risk");
  const clean = quoteCar({ province: "ON", accidents: { atFault: 0, notAtFault: 3 } });
  assert.equal(clean.appetite, "standard");
});

test("monthly payment carries an instalment fee over annual/12", () => {
  const q = quoteCar({ province: "ON" });
  assert.ok(q.payment.monthly * 12 > q.payment.annual, "monthly total should exceed pay-in-full");
});

test("tenant calibrates near $18/mo for $30k contents", () => {
  const q = quoteTenant({ province: "ON", contentsValue: 30000 });
  assert.ok(q.payment.monthly >= 14 && q.payment.monthly <= 26, `got ${q.payment.monthly}`);
  assert.equal(q.appetite, "standard");
});

test("bundling lowers the premium", () => {
  const solo = quoteCar({ province: "ON" });
  const bundled = quoteCar({ province: "ON", bundleHome: true });
  assert.ok(bundled.payment.annual < solo.payment.annual, "bundle should save");
});
