// Tests for the model. Run from the repository folder with:
//
//   node --test tracker/tests/model.test.js
//
// They use Node's built-in test runner and an invented data file. Nothing
// here is real data.

const test = require("node:test");
const assert = require("node:assert");
const { runModel } = require("../js/model.js");
const invented = require("./invented-country.json");

const start = invented.start;

// The default controls with some values replaced.
function controlsWith(changes) {
  return Object.assign({}, invented.controls, changes);
}

function close(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    (message || "") + " expected " + expected + ", got " + actual);
}

// The holdings must sum to the debt in every year of every test, so every
// test runs the model through this.
function run(startValues, controls) {
  const result = runModel(startValues, controls);
  result.rows.forEach(function (row) {
    let sum = row.centralBank;
    Object.keys(row.holdings).forEach(function (k) { sum += row.holdings[k]; });
    close(sum, row.debt, 1e-9, "holdings in " + row.year + ":");
  });
  return result;
}

test("debt stays constant at the debt-stabilizing primary balance", function () {
  const result = run(start, controlsWith({
    capMode: "off",
    passThrough: 0,
    primaryBalance: function (t, stabilizingBalance) { return stabilizingBalance; }
  }));
  result.rows.forEach(function (row) {
    close(row.debt, start.debt, 1e-12, "debt in " + row.year + ":");
  });
});

test("with the cap off, purchases are zero and inflation converges to baseline", function () {
  const controls = controlsWith({ capMode: "off" });
  const result = run(start, controls);
  result.rows.forEach(function (row) {
    assert.strictEqual(row.purchases, 0);
    assert.strictEqual(row.dominance, false);
  });
  // The gap to baseline halves every year with persistence 0.5.
  const gap0 = start.inflation - controls.baselineInflation;
  close(result.rows[1].inflation - controls.baselineInflation, gap0 * 0.5, 1e-12);
  close(result.rows[2].inflation - controls.baselineInflation, gap0 * 0.25, 1e-12);
  close(result.rows[30].inflation, controls.baselineInflation, 1e-9);
});

test("with the cap below the market yield, the yield equals the cap and purchases are positive", function () {
  const result = run(start, controlsWith({ capMode: "fixed", capLevel: 0.03 }));
  const row = result.rows[1];
  assert.ok(row.marketYield > 0.03, "the market yield should be above the cap");
  assert.strictEqual(row.yield, 0.03);
  assert.ok(row.purchases > 0);
  assert.strictEqual(row.dominance, true);
  assert.strictEqual(row.capBroken, false);
  close(row.centralBank, start.centralBank + row.purchases, 1e-12);
  assert.strictEqual(result.headline.firstDominanceYear, 2026);
});

test("with pass-through at zero, purchases leave inflation unchanged", function () {
  const capped = run(start, controlsWith({ capMode: "fixed", capLevel: 0.03, passThrough: 0 }));
  const uncapped = run(start, controlsWith({ capMode: "off", passThrough: 0 }));
  assert.ok(capped.rows[1].purchases > 0, "the capped run should have purchases");
  capped.rows.forEach(function (row, t) {
    assert.strictEqual(row.inflation, uncapped.rows[t].inflation);
  });
});

test("with pass-through above zero, purchases raise next year's inflation", function () {
  const capped = run(start, controlsWith({ capMode: "fixed", capLevel: 0.03, passThrough: 0.2 }));
  const uncapped = run(start, controlsWith({ capMode: "off", passThrough: 0.2 }));
  close(capped.rows[2].inflation - uncapped.rows[2].inflation,
    0.2 * capped.rows[1].purchases, 1e-12);
});

test("raising any group's price-sensitive share raises the yield response to debt", function () {
  // The yield response is how much more the first-year yield rises when
  // debt is one point of GDP higher, with the cap off.
  function yieldResponse(priceSensitive) {
    const low = run(start, controlsWith({ capMode: "off", priceSensitive: priceSensitive, primaryBalance: -0.03 }));
    const high = run(start, controlsWith({ capMode: "off", priceSensitive: priceSensitive, primaryBalance: -0.04 }));
    return high.rows[1].yield - low.rows[1].yield;
  }
  const base = invented.controls.priceSensitive;
  const baseResponse = yieldResponse(base);
  assert.ok(baseResponse > 0);

  ["domesticPrivate", "foreignOfficial"].forEach(function (group) {
    const raised = Object.assign({}, base);
    raised[group] = base[group] + 0.2;
    assert.ok(yieldResponse(raised) > baseResponse,
      "raising " + group + " should raise the yield response");
  });
});

test("with the cap off, a selloff by captive holders raises the first-year yield by the selloff times the yield response", function () {
  const selloff = 0.05; // five points of GDP, all in the first year
  const without = run(start, controlsWith({ capMode: "off" }));
  const withSelloff = run(start, controlsWith({
    capMode: "off",
    selloffs: [{ group: "foreignOfficial", total: selloff, years: 1 }]
  }));
  close(withSelloff.rows[1].yield - without.rows[1].yield,
    selloff * invented.controls.yieldResponse, 1e-12);
  close(without.rows[1].holdings.foreignOfficial - withSelloff.rows[1].holdings.foreignOfficial,
    selloff * (1 - 0.10 * 0.15 / 0.465), 1e-9, "foreign official holdings fall:");
});

test("a selloff spread over several years arrives evenly", function () {
  const without = run(start, controlsWith({ capMode: "off", passThrough: 0 }));
  const withSelloff = run(start, controlsWith({
    capMode: "off",
    passThrough: 0,
    selloffs: [{ group: "foreignOfficial", total: 0.06, years: 3 }]
  }));
  // Year 1 has no feedback yet, so the rise is exactly a third of the total.
  close(withSelloff.rows[1].yield - without.rows[1].yield, 0.02 * 0.03, 1e-12);
});

test("a group cannot sell more than its captive holdings", function () {
  const result = run(start, controlsWith({
    capMode: "off",
    selloffs: [{ group: "foreignOfficial", total: 5, years: 1 }]
  }));
  result.rows.forEach(function (row) {
    assert.ok(row.holdings.foreignOfficial >= -1e-12);
  });
});

test("when the central bank would need more than the whole debt, the warning is raised and the yield exceeds the cap", function () {
  const result = run(start, controlsWith({ capMode: "fixed", capLevel: -0.05 }));
  const row = result.rows[1];
  assert.strictEqual(row.capBroken, true);
  assert.ok(row.yield > -0.05, "the yield should be above the cap");
  close(row.centralBank, row.debt, 1e-12, "the central bank holds all the debt:");
  Object.keys(row.holdings).forEach(function (k) {
    close(row.holdings[k], 0, 1e-12, k + ":");
  });
  assert.strictEqual(result.headline.firstCapBrokenYear, 2026);
  close(result.headline.peakCentralBankShare, 1, 1e-12);
});

test("when purchases use up price-sensitive holdings, the rest comes from captive holders in proportion", function () {
  // A cap low enough to need more than price-sensitive holders have, but
  // not the whole debt.
  const result = run(start, controlsWith({ capMode: "fixed", capLevel: 0.018 }));
  const row = result.rows[1];
  assert.strictEqual(row.capBroken, false);
  assert.strictEqual(row.yield, 0.018);
  // Foreign private holders are fully price-sensitive, so they hold nothing.
  close(row.holdings.foreignPrivate, 0, 1e-12);
  // The two partly captive groups keep the same ratio of captive holdings.
  const captiveRatio = (0.5 * 0.50) / (0.9 * 0.15);
  close(row.holdings.domesticPrivate / row.holdings.foreignOfficial, captiveRatio, 1e-9);
  assert.ok(row.centralBank < row.debt);
});

test("the automatic cap switches on in the first stress year at the previous year's yield", function () {
  // A large deficit and slow growth push the country into fiscal stress.
  const controls = controlsWith({ capMode: "automatic", primaryBalance: -0.08, growth: 0 });
  const result = run(start, controls);
  const first = result.headline.firstStressYear;
  assert.notStrictEqual(first, null, "the scenario should reach fiscal stress");
  const t = first - start.year;
  assert.ok(t > 1, "stress should not start in the first year of this scenario");

  for (let s = 1; s < t; s++) {
    assert.strictEqual(result.rows[s].cap, null);
    assert.strictEqual(result.rows[s].purchases, 0);
  }
  assert.strictEqual(result.rows[t].cap, result.rows[t - 1].yield);
  for (let s = t; s <= controls.years; s++) {
    assert.strictEqual(result.rows[s].cap, result.rows[t].cap, "the cap stays at the same level");
    if (!result.rows[s].capBroken) {
      assert.ok(result.rows[s].yield <= result.rows[s].cap + 1e-12);
    }
  }
});

test("the stress zone marks years when the stabilizing balance is above the threshold", function () {
  const result = run(start, controlsWith({ primaryBalance: -0.08, growth: 0 }));
  result.rows.forEach(function (row, t) {
    if (t === 0) return;
    assert.strictEqual(row.stress, row.stabilizingBalance > start.stressThreshold);
  });
});

test("reactive mode moves the primary balance with debt", function () {
  const controls = controlsWith({ capMode: "off", primaryBalanceMode: "reactive", gamma: 0.03 });
  const result = run(start, controls);
  close(result.rows[1].primaryBalance, -0.03, 1e-12, "year 1 starts at the slider value:");
  for (let t = 2; t <= 5; t++) {
    close(result.rows[t].primaryBalance,
      -0.03 + 0.03 * (result.rows[t - 1].debt - start.debt), 1e-12);
  }
});

test("the average interest rate reprices one m-th of the debt each year", function () {
  const result = run(start, controlsWith({ capMode: "off" }));
  close(result.rows[1].averageRate, (5 / 6) * 0.03 + (1 / 6) * 0.04, 1e-12);
  close(result.rows[2].averageRate,
    (5 / 6) * result.rows[1].averageRate + (1 / 6) * result.rows[1].yield, 1e-12);
});

test("the first year matches a calculation by hand", function () {
  const result = run(start, controlsWith({ capMode: "off" }));
  const row = result.rows[1];
  const inflation = 0.02 + 0.5 * (0.03 - 0.02);
  const nominal = 1.02 * (1 + inflation) - 1;
  const rate = (5 / 6) * 0.03 + (1 / 6) * 0.04;
  const debt = 1 * (1 + rate) / (1 + nominal) + 0.03;
  const captive = (0.5 * 0.50 + 0.9 * 0.15 + 0) * debt;
  const absorb = debt - 0.15 - captive - 0.465;
  close(row.inflation, inflation, 1e-12);
  close(row.debt, debt, 1e-12);
  close(row.yield, 0.04 + (inflation - 0.03) + 0.03 * absorb, 1e-12);
  close(row.interest, rate * 1 / (1 + nominal), 1e-12);
  close(row.interestToRevenue, row.interest / 0.17, 1e-12);
  close(row.financingNeed, row.interest + 0.03 + (1 / 6) / (1 + nominal), 1e-12);
  close(row.realReturn, (1 + rate) / (1 + inflation), 1e-12);
  close(row.exchangeRate, 1.02 / (1 + inflation), 1e-12);
});

test("large surpluses stop at zero debt", function () {
  const result = run(start, controlsWith({ capMode: "off", primaryBalance: 0.2 }));
  const last = result.rows[30];
  assert.strictEqual(last.debt, 0);
  assert.strictEqual(last.debtRepaid, true);
  assert.strictEqual(last.centralBank, 0);
});

test("the model works with a merged foreign group", function () {
  const merged = Object.assign({}, start, {
    holdings: { domesticPrivate: 0.50, foreign: 0.35 }
  });
  const result = run(merged, controlsWith({
    priceSensitive: { domesticPrivate: 0.5, foreign: 0.6 }
  }));
  assert.strictEqual(result.rows.length, 31);
});

test("the same inputs always give the same outputs, and the inputs are not changed", function () {
  const controls = controlsWith({ selloffs: [{ group: "foreignOfficial", total: 0.05, years: 5 }] });
  const startBefore = JSON.stringify(start);
  const controlsBefore = JSON.stringify(controls);
  const first = run(start, controls);
  const second = run(start, controls);
  assert.deepStrictEqual(first, second);
  assert.strictEqual(JSON.stringify(start), startBefore);
  assert.strictEqual(JSON.stringify(controls), controlsBefore);
});

test("a missing input stops with a clear message", function () {
  const broken = Object.assign({}, start);
  delete broken.revenue;
  assert.throws(function () { runModel(broken, invented.controls); }, /start\.revenue/);
  assert.throws(function () {
    runModel(Object.assign({}, start, { holdings: { domesticPrivate: 0.2 } }),
      controlsWith({ priceSensitive: { domesticPrivate: 0.5 } }));
  }, /more than 1%/);
});
