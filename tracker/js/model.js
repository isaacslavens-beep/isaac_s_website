// Sovereign debt simulator: the model.
//
// One function, runModel(start, controls), projects one country forward in
// annual steps. It is a pure function: it reads only its two arguments, it
// changes neither of them, and the same inputs always give the same outputs.
// It knows nothing about the page, so the same file runs in the browser and
// in the tests.
//
// Every quantity is a share of GDP stored as a fraction (0.05 means 5% of
// GDP), and every rate is a fraction per year (0.04 means 4%).
//
// start: the country's values in the starting year
//   year              the starting year, for example 2025
//   debt              d    debt
//   centralBank       cb   central bank holdings
//   holdings          h_k  holdings of each other group, for example
//                          { domesticPrivate, foreignOfficial, foreignPrivate }
//   yield             i    yield on new borrowing
//   averageRate       r    average interest rate on the whole debt stock
//   inflation         pi   inflation
//   revenue           tau  government revenue
//   stressThreshold        the largest five-year average primary balance in
//                          the country's history
//
// controls: the scenario
//   years                  how many years to project
//   growth            g    real growth: one number, or a list with one per year
//   primaryBalance    pb   positive is a surplus: one number, a list with one
//                          per year, or a function (see primaryBalanceFor)
//   primaryBalanceMode     "fixed" or "reactive"
//   gamma                  reactive mode: response of the balance to debt
//   capMode                "automatic", "fixed" or "off"
//   capLevel               the cap when capMode is "fixed"
//   priceSensitive    w_k  share of each group's holdings that is
//                          price-sensitive, with the same keys as holdings
//   yieldResponse     theta
//   passThrough       lambda: points of inflation next year for each point
//                          of GDP by which central bank holdings rise
//   persistence       kappa
//   baselineInflation pi_base
//   foreignInflation  pi_f
//   maturity          m    average maturity in years
//   runoff            q    central bank runoff per year. With no runoff the
//                          central bank keeps its share of the debt.
//   selloffs               a list of { group, total, years }: the group sells
//                          "total" (a share of GDP) evenly over "years" years.
//                          Its captive and price-sensitive holdings shrink
//                          in proportion, and the remaining price-sensitive
//                          holders must absorb what it sold.

function runModel(start, controls) {
  checkInputs(start, controls);

  var groups = Object.keys(start.holdings);
  var d0 = start.debt;
  var i0 = start.yield;
  var pi0 = start.inflation;

  var w = controls.priceSensitive;
  var theta = Math.max(controls.yieldResponse, 1e-9); // avoids dividing by zero
  var lambda = controls.passThrough;
  var kappa = controls.persistence;
  var piBase = controls.baselineInflation;
  var piF = controls.foreignInflation;
  var m = controls.maturity;
  var q = controls.runoff;

  // Starting holdings. The data may be off from the debt by a rounding gap
  // (the pipeline allows up to 1%), so the groups are scaled to fit exactly.
  var h0 = scaleToFit(start.holdings, d0 - start.centralBank);

  var totalH0 = 0;
  groups.forEach(function (k) { totalH0 += h0[k]; });

  // The cap. In automatic mode it stays null until the first stress year.
  var cap = controls.capMode === "fixed" ? controls.capLevel : null;

  // Year 0 is the starting year, taken straight from the data.
  var rows = [{
    year: start.year,
    debt: d0,
    centralBank: start.centralBank,
    holdings: h0,
    yield: i0,
    marketYield: i0,
    averageRate: start.averageRate,
    inflation: pi0,
    purchases: 0,
    buying: 0,
    growth: null,
    nominalGrowth: null,
    primaryBalance: null,
    stabilizingBalance: null,
    interest: null,
    interestToRevenue: null,
    financingNeed: null,
    priceLevel: 1,
    realReturn: 1,
    exchangeRate: 1,
    cap: null,
    stress: false,
    dominance: false,
    capBroken: false,
    debtRepaid: false
  }];

  for (var t = 1; t <= controls.years; t++) {
    var prev = rows[t - 1];

    // 1. Inflation, from last year's rise in central bank holdings.
    var inflation = piBase + lambda * prev.buying + kappa * (prev.inflation - piBase);

    // 2. Nominal growth.
    var growth = valueForYear(controls.growth, t);
    var nominalGrowth = (1 + growth) * (1 + inflation) - 1;

    // The average interest rate for this year was set at the end of last
    // year: one m-th of the debt repriced at last year's yield (step 8).
    var averageRate = (1 - 1 / m) * prev.averageRate + (1 / m) * prev.yield;

    // The primary balance that would hold debt steady this year.
    var stabilizingBalance = prev.debt * (averageRate - nominalGrowth) / (1 + nominalGrowth);

    // 3. Debt.
    var primaryBalance = primaryBalanceFor(controls, t, prev.debt, d0, stabilizingBalance);
    var debt = prev.debt * (1 + averageRate) / (1 + nominalGrowth) - primaryBalance;
    var debtRepaid = false;
    if (debt <= 0) {
      // Surpluses have repaid everything. Debt stops at zero.
      debt = 0;
      debtRepaid = true;
    }

    // Fiscal stress: the balance needed to hold debt steady is more than
    // the country has ever sustained.
    var stress = stabilizingBalance > start.stressThreshold;

    // Automatic cap: switched on in the first stress year, at last year's
    // yield, and kept from then on.
    if (controls.capMode === "automatic" && cap === null && stress) {
      cap = prev.yield;
    }

    // 4. Captive holdings: the part of each group that is not
    // price-sensitive keeps its share of the debt, less any selloff. A
    // selloff also shrinks the group's price-sensitive base, in
    // proportion, and a group cannot sell more than it started with.
    // W is the price-sensitive base of all groups together.
    var captive = {};
    var base = {};
    var totalCaptive = 0;
    var W = 0;
    groups.forEach(function (k) {
      var sold = Math.min(selloffSoFar(controls.selloffs, k, t), h0[k]);
      captive[k] = Math.max((1 - w[k]) * (h0[k] * debt / d0 - sold), 0);
      base[k] = w[k] * (h0[k] - sold);
      totalCaptive += captive[k];
      W += base[k];
    });

    // 5. What price-sensitive holders must absorb beyond their starting
    // holdings, with the central bank on its passive path. On that path
    // the central bank keeps the share of the debt it held last year,
    // less any runoff. It cannot go below zero or above the debt.
    var lastShare = prev.debt > 0 ? prev.centralBank / prev.debt : 0;
    var passiveCentralBank = Math.min(Math.max(lastShare * debt - q, 0), debt);
    var passiveAbsorb = debt - passiveCentralBank - totalCaptive - W;

    // 6. The market yield, then intervention.
    var inflationChange = inflation - pi0;
    var marketYield = i0 + inflationChange + theta * passiveAbsorb;

    var absorb = passiveAbsorb; // M: what price-sensitive holders end up absorbing
    var yieldNow = marketYield;
    var purchases = 0;
    var capBroken = false;

    if (cap !== null && marketYield > cap) {
      // What price-sensitive holders will absorb at the cap.
      var wanted = (cap - i0 - inflationChange) / theta;
      // The lowest M can go: the central bank holds the entire debt.
      var lowest = -(W + totalCaptive);
      if (wanted < lowest - 1e-12) {
        // Even owning all the debt does not bring the yield down to the
        // cap. The central bank holds everything and the yield stays
        // above the cap.
        absorb = lowest;
        yieldNow = i0 + inflationChange + theta * lowest;
        capBroken = true;
      } else {
        absorb = Math.max(wanted, lowest);
        yieldNow = cap;
      }
      purchases = passiveAbsorb - absorb;
    }
    var centralBank = passiveCentralBank + purchases;

    // Price-sensitive holdings cannot fall below zero. Anything beyond
    // that comes out of captive holders, in proportion to their holdings.
    var priceSensitiveTotal = Math.max(W + absorb, 0);
    var takenFromCaptive = Math.max(-(W + absorb), 0);

    // 7. Each group's holdings: its captive part plus its portion of what
    // price-sensitive holders hold.
    var holdings = {};
    var sum = centralBank;
    groups.forEach(function (k) {
      var captivePart = captive[k];
      if (totalCaptive > 0) {
        captivePart -= takenFromCaptive * captive[k] / totalCaptive;
      }
      // If no group is price-sensitive at all, split by starting holdings.
      var portion = W > 0 ? base[k] / W : h0[k] / totalH0;
      holdings[k] = captivePart + portion * priceSensitiveTotal;
      sum += holdings[k];
    });

    // The four holdings must sum to the debt every year.
    if (Math.abs(sum - debt) > 1e-9) {
      throw new Error("Year " + (start.year + t) + ": holdings sum to " + sum +
        " but debt is " + debt);
    }

    // Derived outputs. Last year's debt is divided by (1 + nominal growth)
    // to express it as a share of this year's GDP.
    var interest = averageRate * prev.debt / (1 + nominalGrowth);
    var maturing = prev.debt / m / (1 + nominalGrowth);

    rows.push({
      year: start.year + t,
      debt: debt,
      centralBank: centralBank,
      holdings: holdings,
      yield: yieldNow,
      marketYield: marketYield,
      averageRate: averageRate,
      inflation: inflation,
      purchases: purchases,   // bought to hold the cap
      // The rise in holdings as a share of GDP, for whatever reason:
      // keeping its share of a growing debt, or holding the cap.
      buying: centralBank - prev.centralBank,
      growth: growth,
      nominalGrowth: nominalGrowth,
      primaryBalance: primaryBalance,
      stabilizingBalance: stabilizingBalance,
      interest: interest,
      interestToRevenue: interest / start.revenue,
      financingNeed: interest - primaryBalance + maturing,
      priceLevel: prev.priceLevel * (1 + inflation),
      realReturn: prev.realReturn * (1 + averageRate) / (1 + inflation),
      exchangeRate: prev.exchangeRate * (1 + piF) / (1 + inflation),
      cap: cap,
      stress: stress,
      // Fiscal dominance: the central bank is buying to hold the cap, or
      // already holds all the debt and still cannot hold it.
      dominance: purchases > 0 || capBroken,
      capBroken: capBroken,
      debtRepaid: debtRepaid
    });
  }

  return { rows: rows, headline: headlineFigures(rows) };
}

// The primary balance for year t.
function primaryBalanceFor(controls, t, lastDebt, startDebt, stabilizingBalance) {
  var pb = controls.primaryBalance;
  // A function is given the year number and the debt-stabilizing balance.
  // The tests use this to hold debt steady.
  if (typeof pb === "function") {
    return pb(t, stabilizingBalance);
  }
  var base = valueForYear(pb, t);
  if (controls.primaryBalanceMode === "reactive") {
    return base + controls.gamma * (lastDebt - startDebt);
  }
  return base;
}

// A control is either one number for every year or a list with one per year.
function valueForYear(value, t) {
  if (Array.isArray(value)) {
    return t <= value.length ? value[t - 1] : value[value.length - 1];
  }
  return value;
}

// How much of GDP a group has sold by year t, across all selloffs.
function selloffSoFar(selloffs, group, t) {
  var sold = 0;
  (selloffs || []).forEach(function (s) {
    if (s.group === group) {
      sold += s.total * Math.min(t / Math.max(s.years, 1), 1);
    }
  });
  return sold;
}

// Scales the holder groups so they sum exactly to the target.
function scaleToFit(holdings, target) {
  var total = 0;
  Object.keys(holdings).forEach(function (k) { total += holdings[k]; });
  if (Math.abs(total - target) > 0.01 * target + 1e-12) {
    throw new Error("Starting holdings sum to " + total + " but debt less central bank holdings is " +
      target + ". The gap is more than 1%.");
  }
  var scaled = {};
  Object.keys(holdings).forEach(function (k) {
    scaled[k] = total > 0 ? holdings[k] * target / total : 0;
  });
  return scaled;
}

// The figures shown above the chart.
function headlineFigures(rows) {
  var last = rows[rows.length - 1];
  var years = rows.length - 1;
  var firstStress = null;
  var firstDominance = null;
  var firstCapBroken = null;
  var peakShare = rows[0].debt > 0 ? rows[0].centralBank / rows[0].debt : 0;

  rows.forEach(function (row, t) {
    if (t === 0) return;
    if (row.stress && firstStress === null) firstStress = row.year;
    if (row.dominance && firstDominance === null) firstDominance = row.year;
    if (row.capBroken && firstCapBroken === null) firstCapBroken = row.year;
    if (row.debt > 0) peakShare = Math.max(peakShare, row.centralBank / row.debt);
  });

  return {
    finalDebt: last.debt,
    firstStressYear: firstStress,         // null means "not reached"
    firstDominanceYear: firstDominance,   // null means "not reached"
    firstCapBrokenYear: firstCapBroken,   // null means the cap always held
    peakCentralBankShare: peakShare,
    purchasingPowerLoss: 1 - 1 / last.priceLevel,
    annualRealReturn: years > 0 ? Math.pow(last.realReturn, 1 / years) - 1 : 0
  };
}

// Stops with a clear message if an input is missing or not a number.
function checkInputs(start, controls) {
  var startNumbers = ["year", "debt", "centralBank", "yield", "averageRate",
    "inflation", "revenue", "stressThreshold"];
  var controlNumbers = ["years", "yieldResponse", "passThrough", "persistence",
    "baselineInflation", "foreignInflation", "maturity", "runoff"];

  startNumbers.forEach(function (name) {
    if (!isNumber(start[name])) throw new Error("start." + name + " must be a number");
  });
  controlNumbers.forEach(function (name) {
    if (!isNumber(controls[name])) throw new Error("controls." + name + " must be a number");
  });
  if (!(start.debt > 0)) throw new Error("start.debt must be above zero");
  if (!(start.revenue > 0)) throw new Error("start.revenue must be above zero");
  if (!(controls.maturity >= 1)) throw new Error("controls.maturity must be at least 1");

  if (!start.holdings || Object.keys(start.holdings).length === 0) {
    throw new Error("start.holdings must list at least one holder group");
  }
  Object.keys(start.holdings).forEach(function (k) {
    if (!isNumber(start.holdings[k])) throw new Error("start.holdings." + k + " must be a number");
    var share = controls.priceSensitive ? controls.priceSensitive[k] : undefined;
    if (!isNumber(share) || share < 0 || share > 1) {
      throw new Error("controls.priceSensitive." + k + " must be between 0 and 1");
    }
  });

  if (["automatic", "fixed", "off"].indexOf(controls.capMode) === -1) {
    throw new Error('controls.capMode must be "automatic", "fixed" or "off"');
  }
  if (controls.capMode === "fixed" && !isNumber(controls.capLevel)) {
    throw new Error("controls.capLevel must be a number when capMode is fixed");
  }
  if (controls.primaryBalanceMode === "reactive" && !isNumber(controls.gamma)) {
    throw new Error("controls.gamma must be a number in reactive mode");
  }
}

function isNumber(x) {
  return typeof x === "number" && isFinite(x);
}

// Lets the tests load this file with require(). In the browser, runModel
// is simply a global function.
if (typeof module !== "undefined") {
  module.exports = { runModel: runModel };
}
