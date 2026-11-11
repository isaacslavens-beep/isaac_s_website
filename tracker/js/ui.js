// Sovereign debt simulator: the page.
//
// This file loads the data files, builds the controls, runs the model
// whenever a control changes, and hands the results to charts.js.
// Every default and range comes from the data files, not from this file.

var COUNTRIES = [
  { key: "united-states", code: "us", name: "United States" },
  { key: "japan", code: "jp", name: "Japan" },
  { key: "united-kingdom", code: "uk", name: "United Kingdom" },
  { key: "canada", code: "ca", name: "Canada" }
];

var GROUP_LABELS = {
  domesticPrivate: "Domestic private",
  foreignOfficial: "Foreign official",
  foreignPrivate: "Foreign private",
  foreign: "Foreign"
};

// Everything the page remembers while it is open.
var page = {
  presets: null,
  meta: null,
  data: {},        // country key -> its data file
  controls: {},    // country key -> that country's current control values
  country: null,   // the country being shown
  chart: "debt",
  range: 30,
  plot: null,      // the uPlot object on screen
  result: null     // the latest model result
};

// ---------------------------------------------------------------- formats

function percent(decimals) {
  return function (v) { return (v * 100).toFixed(decimals) + "%"; };
}

var FORMATS = {
  percent0: percent(0),
  percent1: percent(1),
  basisPoints: function (v) { return (v * 100).toFixed(1) + " bp"; },
  years0: function (v) { return v.toFixed(0) + (v === 1 ? " year" : " years"); },
  years1: function (v) { return v.toFixed(1) + " years"; },
  number2: function (v) { return v.toFixed(2); }
};

// ---------------------------------------------------------------- controls

// The controls, in the order they appear. `section` is where each one
// goes: main, scenario or advanced. The one-line descriptions are shown
// under each label.
function controlList(country) {
  var list = [
    { key: "growth", section: "main", type: "range", format: "percent1",
      label: "Real growth",
      help: "How fast the economy grows each year, after inflation." },
    { key: "primaryBalance", section: "main", type: "range", format: "percent1",
      label: "Primary balance",
      help: "The budget balance before interest, as a share of GDP. Negative is a deficit." },
    { key: "capMode", section: "main", type: "select",
      label: "Yield cap",
      help: "The highest yield the central bank tolerates before it buys debt.",
      options: [
        ["automatic", "Automatic: from the first fiscal stress year"],
        ["fixed", "Fixed level"],
        ["off", "Off: never intervenes"]
      ] },
    { key: "capLevel", section: "main", type: "range", format: "percent1", indent: true,
      showWhen: function (c) { return c.capMode === "fixed"; },
      label: "Cap level",
      help: "The yield the central bank holds when the cap is fixed." }
  ];

  Object.keys(country.start.holdings).forEach(function (group) {
    list.push({ key: "w_" + group, section: "main", type: "range", format: "percent0",
      label: "Price-sensitive share: " + GROUP_LABELS[group].toLowerCase(),
      help: "The share of these holders that asks for a higher yield to hold more debt." });
  });

  list.push({ key: "passThrough", section: "main", type: "range", format: "number2",
    label: "Pass-through",
    help: "Points of inflation the next year for each point of GDP the central bank buys." });

  if (country.start.holdings.foreignOfficial) {
    list.push(
      { key: "selloffOn", section: "scenario", type: "check",
        label: "Foreign official selloff",
        help: "Foreign central banks and governments sell part of their holdings." },
      { key: "selloffShare", section: "scenario", type: "range", format: "percent0", indent: true,
        showWhen: function (c) { return c.selloffOn; },
        label: "Share sold", help: "The share of foreign official holdings sold." },
      { key: "selloffYears", section: "scenario", type: "range", format: "years0", indent: true,
        showWhen: function (c) { return c.selloffOn; },
        label: "Over", help: "The number of years the selling is spread over." }
    );
  }
  if (country.start.japanHoldings) {
    list.push(
      { key: "japanOn", section: "scenario", type: "check",
        label: "Japanese repatriation",
        help: "Holders in Japan sell part of their Treasuries and bring the money home." },
      { key: "japanShare", section: "scenario", type: "range", format: "percent0", indent: true,
        preset: "selloffShare",
        showWhen: function (c) { return c.japanOn; },
        label: "Share sold", help: "The share of Japan-resident holdings sold." },
      { key: "japanYears", section: "scenario", type: "range", format: "years0", indent: true,
        preset: "selloffYears",
        showWhen: function (c) { return c.japanOn; },
        label: "Over", help: "The number of years the selling is spread over." }
    );
  }

  list.push(
    { key: "persistence", section: "advanced", type: "range", format: "number2",
      label: "Inflation persistence",
      help: "How much of last year's gap between inflation and its baseline carries into this year." },
    { key: "baselineInflation", section: "advanced", type: "range", format: "percent1",
      label: "Baseline inflation",
      help: "The inflation rate the economy returns to when the central bank is not buying debt." },
    { key: "runoff", section: "advanced", type: "range", format: "percent1",
      label: "Central bank runoff",
      help: "How much the central bank lets its holdings shrink each year, as a share of GDP." },
    { key: "yieldResponse", section: "advanced", type: "range", format: "basisPoints",
      label: "Yield response",
      help: "Basis points of yield for each point of GDP that price-sensitive holders must absorb." },
    { key: "foreignInflation", section: "advanced", type: "range", format: "percent1",
      label: "Foreign inflation",
      help: "Inflation abroad, used for the exchange rate." },
    { key: "maturity", section: "advanced", type: "range", format: "years1",
      label: "Average maturity",
      help: "The average number of years until the debt is repaid. With a shorter maturity, a change in yields reaches the interest bill sooner." }
  );
  return list;
}

// The range and default of one control, from presets.json and the
// country's data file.
function presetFor(control, country) {
  if (control.key.indexOf("w_") === 0) {
    var group = control.key.slice(2);
    var shares = page.presets.priceSensitive;
    var fromData = (country.parameters.priceSensitive || {})[group];
    var fallback = shares.defaults[group];
    return {
      min: shares.min, max: shares.max, step: shares.step,
      default: fromData ? fromData.value : fallback.default,
      illustrative: !fromData,
      basis: fromData ? "Default: " + fromData.note + "." : fallback.basis
    };
  }
  var preset = Object.assign({}, page.presets.controls[control.preset || control.key] || {});
  var start = country.start;
  if (control.key === "growth") preset.default = start.growth.value;
  if (control.key === "primaryBalance") preset.default = start.primaryBalance.value;
  if (control.key === "capLevel") preset.default = start.yield.value;
  if (control.key === "maturity") preset.default = start.maturity.value;
  if (control.key === "capMode") preset.default = "automatic";
  if (control.type === "check") preset.default = false;
  return preset;
}

// A value moved onto the slider's steps and kept inside its range.
function snap(value, preset) {
  var steps = Math.round((value - preset.min) / preset.step);
  var snapped = preset.min + steps * preset.step;
  snapped = Math.min(preset.max, Math.max(preset.min, snapped));
  return parseFloat(snapped.toFixed(6));
}

function defaultControls(country) {
  var values = {};
  controlList(country).forEach(function (control) {
    var preset = presetFor(control, country);
    values[control.key] = control.type === "range" ? snap(preset.default, preset) : preset.default;
  });
  return values;
}

// Builds the control panel for the current country.
function buildControls() {
  var country = page.data[page.country];
  var values = page.controls[page.country];
  var sections = {
    main: document.getElementById("main-controls"),
    scenario: document.getElementById("scenario-controls"),
    advanced: document.getElementById("advanced-controls")
  };
  Object.keys(sections).forEach(function (name) { sections[name].textContent = ""; });

  controlList(country).forEach(function (control) {
    var preset = presetFor(control, country);
    var id = "control-" + control.key;
    var box = document.createElement("div");
    box.className = "control" + (control.type === "check" ? " check" : "") + (control.indent ? " indent" : "");
    box.dataset.key = control.key;

    var label = document.createElement("label");
    label.htmlFor = id;
    var input;

    if (control.type === "range") {
      input = document.createElement("input");
      input.type = "range";
      input.min = preset.min;
      input.max = preset.max;
      input.step = preset.step;
      input.value = values[control.key];
      var output = document.createElement("output");
      output.htmlFor = id;
      output.textContent = FORMATS[control.format](values[control.key]);
      label.append(control.label, output);
      input.addEventListener("input", function () {
        values[control.key] = parseFloat(input.value);
        output.textContent = FORMATS[control.format](values[control.key]);
        update();
      });
    } else if (control.type === "select") {
      input = document.createElement("select");
      control.options.forEach(function (option) {
        var element = document.createElement("option");
        element.value = option[0];
        element.textContent = option[1];
        input.append(element);
      });
      input.value = values[control.key];
      label.append(control.label);
      input.addEventListener("change", function () {
        values[control.key] = input.value;
        update();
      });
    } else {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = values[control.key];
      label.append(input, " " + control.label);
      input.addEventListener("change", function () {
        values[control.key] = input.checked;
        update();
      });
    }
    input.id = id;

    var help = document.createElement("p");
    help.className = "help";
    help.textContent = control.help;

    box.append(label, help);
    if (control.type !== "check") box.append(input);
    if (preset.illustrative || control.key.indexOf("w_") === 0) {
      var basis = document.createElement("p");
      basis.className = "basis";
      basis.textContent = preset.basis;
      box.append(basis);
    }
    box.showWhen = control.showWhen;
    sections[control.section].append(box);
  });
  showOrHideControls();
}

// Some controls only apply when another is switched on.
function showOrHideControls() {
  var values = page.controls[page.country];
  document.querySelectorAll("#controls .control").forEach(function (box) {
    box.hidden = box.showWhen ? !box.showWhen(values) : false;
  });
}

// ---------------------------------------------------------------- model

function value(item) {
  return item.value;
}

// Turns a country's data and control values into the model's two inputs.
function modelInputs(country, c) {
  var s = country.start;
  var holdings = {};
  var priceSensitive = {};
  Object.keys(s.holdings).forEach(function (group) {
    holdings[group] = value(s.holdings[group]);
    priceSensitive[group] = c["w_" + group];
  });

  var selloffs = [];
  if (c.selloffOn) {
    selloffs.push({ group: "foreignOfficial", total: c.selloffShare * holdings.foreignOfficial, years: c.selloffYears });
  }
  if (c.japanOn) {
    Object.keys(s.japanHoldings.split).forEach(function (group) {
      selloffs.push({
        group: group,
        total: c.japanShare * s.japanHoldings.value * s.japanHoldings.split[group],
        years: c.japanYears
      });
    });
  }

  return {
    start: {
      year: s.year,
      debt: value(s.debt),
      centralBank: value(s.centralBank),
      holdings: holdings,
      yield: value(s.yield),
      averageRate: value(s.averageRate),
      inflation: value(s.inflation),
      revenue: value(s.revenue),
      stressThreshold: value(s.stressThreshold)
    },
    controls: {
      years: page.presets.years,
      growth: c.growth,
      primaryBalance: c.primaryBalance,
      primaryBalanceMode: "fixed",
      capMode: c.capMode,
      capLevel: c.capLevel,
      priceSensitive: priceSensitive,
      yieldResponse: c.yieldResponse,
      passThrough: c.passThrough,
      persistence: c.persistence,
      baselineInflation: c.baselineInflation,
      foreignInflation: c.foreignInflation,
      maturity: c.maturity,
      runoff: c.runoff,
      selloffs: selloffs
    }
  };
}

// ---------------------------------------------------------------- charts

// One value per year of history, or null. `name` is a series in the
// country's data file.
function historyValue(country, name, year) {
  var series = country.history[name];
  if (!series) return null;
  var index = year - series.firstYear;
  return index >= 0 && index < series.values.length ? series.values[index] : null;
}

function shareOfDebt(amount, debt) {
  return amount === null || debt === null || debt <= 0 ? null : amount / debt * 100;
}

// The charts. Each line says where its history comes from (`history`, a
// function of the year), where its projection comes from (`projection`, a
// function of the model's row for that year), and which data series its
// source line should name.
function chartList(country) {
  function history(name, scale) {
    return function (year) {
      var v = historyValue(country, name, year);
      return v === null ? null : v * scale;
    };
  }
  function debtShareHistory(name) {
    return function (year) {
      return shareOfDebt(historyValue(country, name, year), historyValue(country, "debt", year));
    };
  }
  var none = function () { return null; };

  var holders = [{
    label: "Central bank", color: 1,
    history: debtShareHistory("centralBank"),
    projection: function (row) { return shareOfDebt(row.centralBank, row.debt); }
  }];
  Object.keys(country.start.holdings).forEach(function (group, n) {
    holders.push({
      label: GROUP_LABELS[group], color: n + 2,
      history: debtShareHistory(group),
      projection: function (row) { return shareOfDebt(row.holdings[group], row.debt); }
    });
  });

  return [
    { key: "debt", title: "Debt", units: "Percent of GDP",
      rightLabel: "Percent of GDP", rightUnit: "%",
      sources: ["debt"],
      series: [
        { label: "Debt", color: 1, unit: "%", decimals: 1,
          history: history("debt", 100), projection: function (row) { return row.debt * 100; } }
      ] },

    { key: "yields", title: "Yields and interest", units: "Percent",
      rightLabel: "Percent", rightUnit: "%", rightDecimals: 1,
      leftLabel: "Percent of revenue", leftUnit: "%",
      sources: ["yield", "averageRate", "interestToRevenue"],
      series: [
        { label: "Yield on new borrowing", color: 1, unit: "%", decimals: 2,
          history: history("yield", 100), projection: function (row) { return row.yield * 100; } },
        { label: "Average interest rate", color: 2, unit: "%", decimals: 2,
          history: history("averageRate", 100), projection: function (row) { return row.averageRate * 100; } },
        { label: "Interest as a share of revenue (left axis)", color: 3, unit: "%", decimals: 1, axis: "left",
          history: history("interestToRevenue", 100),
          projection: function (row) { return row.interestToRevenue === null ? null : row.interestToRevenue * 100; } }
      ] },

    { key: "holders", title: "Who holds the debt", units: "Percent of the debt",
      rightLabel: "Percent of the debt", rightUnit: "%",
      stacked: true,
      sources: ["centralBank"].concat(Object.keys(country.start.holdings)),
      series: holders.map(function (s) { return Object.assign({ unit: "%", decimals: 1 }, s); }) },

    { key: "central-bank", title: "Central bank", units: "Percent of the debt",
      rightLabel: "Percent of the debt", rightUnit: "%",
      leftLabel: "Percent of GDP", leftUnit: "%", leftDecimals: 1,
      sources: ["centralBank", "debt"],
      series: [
        { label: "Central bank holdings, share of the debt", color: 1, unit: "%", decimals: 1,
          history: debtShareHistory("centralBank"),
          projection: function (row) { return shareOfDebt(row.centralBank, row.debt); } },
        { label: "Purchases in the year, share of GDP (left axis)", color: 2, unit: "%", decimals: 2, axis: "left",
          history: none, projection: function (row) { return row.purchases * 100; } }
      ] },

    { key: "inflation", title: "Inflation and currency", units: "Percent",
      rightLabel: "Percent", rightUnit: "%", rightDecimals: 1,
      leftLabel: "Index, starting year = 100",
      sources: ["inflation"],
      series: [
        { label: "Inflation", color: 1, unit: "%", decimals: 2,
          history: history("inflation", 100), projection: function (row) { return row.inflation * 100; } },
        { label: "Price level (left axis)", color: 2, decimals: 1, axis: "left",
          history: none, projection: function (row) { return row.priceLevel * 100; } },
        { label: "Exchange rate (left axis)", color: 3, decimals: 1, axis: "left",
          history: none, projection: function (row) { return row.exchangeRate * 100; } }
      ] },

    { key: "return", title: "Lender's return", units: "Index, starting year = 100",
      rightLabel: "Index, starting year = 100",
      sources: [],
      series: [
        { label: "Real return index", color: 1, decimals: 1,
          history: none, projection: function (row) { return row.realReturn * 100; } }
      ] }
  ];
}

function currentChart() {
  var list = chartList(page.data[page.country]);
  return list.filter(function (chart) { return chart.key === page.chart; })[0] || list[0];
}

// The years and values of the current chart, ready to plot or download.
function chartTable(definition) {
  var country = page.data[page.country];
  var rows = page.result.rows;
  var startYear = country.start.year;

  // History starts at the first year any line has data.
  var firstYear = startYear;
  for (var year = startYear - 1; year >= 1900; year--) {
    var any = definition.series.some(function (s) { return s.history(year) !== null; });
    if (any) firstYear = year;
  }

  var years = [];
  for (var y = firstYear; y <= startYear + rows.length - 1; y++) years.push(y);
  var startIndex = startYear - firstYear;

  var series = definition.series.map(function (s) {
    var values = years.map(function (year, i) {
      if (i < startIndex) return s.history(year);
      var projected = s.projection(rows[i - startIndex]);
      // In the starting year, a line with no model value uses its history.
      return i === startIndex && projected === null ? s.history(year) : projected;
    });
    return Object.assign({}, s, { values: values, axis: s.axis || "right" });
  });
  return { years: years, startIndex: startIndex, series: series };
}

function draw() {
  var definition = currentChart();
  var table = chartTable(definition);
  var startYear = table.years[table.startIndex];

  var zones = [];
  page.result.rows.forEach(function (row, t) {
    if (t === 0) return;
    if (row.dominance) zones.push({ year: row.year, type: "dominance" });
    else if (row.stress) zones.push({ year: row.year, type: "stress" });
  });

  var container = document.getElementById("chart");
  if (page.plot) page.plot.destroy();
  page.plot = drawChart(container, Object.assign({}, definition, table, {
    zones: zones,
    xMin: Math.max(table.years[0], startYear - page.range / 2),
    xMax: startYear + page.range
  }));
}

// ---------------------------------------------------------------- the text around the chart

function fillText() {
  var country = page.data[page.country];
  var definition = currentChart();
  var table = chartTable(definition);
  var first = table.series[0];
  var startValue = first.values[table.startIndex];
  var h = page.result.headline;
  var lastYear = page.result.rows[page.result.rows.length - 1].year;
  var years = page.result.rows.length - 1;

  document.getElementById("chart-title").textContent = country.name + ": " + definition.title;
  document.getElementById("chart-meta").textContent =
    first.label + " in " + country.start.year + ": " +
    (startValue === null ? "no data" : startValue.toFixed(first.decimals) + (first.unit || "")) +
    " · Data updated " + page.meta.lastSuccessfulRun +
    " · Units: " + definition.units +
    " · Frequency: annual";

  var figures = [
    ["Debt in " + lastYear, FORMATS.percent0(h.finalDebt) + " of GDP"],
    ["First year of fiscal stress", h.firstStressYear || "not reached"],
    ["First year of fiscal dominance", h.firstDominanceYear || "not reached"],
    ["Peak central bank share of the debt", FORMATS.percent0(h.peakCentralBankShare)],
    ["Loss of purchasing power over " + years + " years", FORMATS.percent0(h.purchasingPowerLoss)],
    ["Real return to the lender, per year", FORMATS.percent1(h.annualRealReturn)]
  ];
  var headline = document.getElementById("headline");
  headline.textContent = "";
  figures.forEach(function (figure) {
    var box = document.createElement("div");
    var term = document.createElement("dt");
    var detail = document.createElement("dd");
    term.textContent = figure[0];
    detail.textContent = figure[1];
    box.append(term, detail);
    headline.append(box);
  });

  var warning = document.getElementById("warning");
  warning.hidden = h.firstCapBrokenYear === null;
  if (h.firstCapBrokenYear !== null) {
    warning.textContent = "The cap cannot be held. From " + h.firstCapBrokenYear +
      " the central bank holds all of the debt and the yield rises above the cap.";
  }

  // The source line names the publisher and series behind the history.
  var labels = [];
  definition.sources.forEach(function (name) {
    (country.history[name] ? country.history[name].source : []).forEach(function (key) {
      var label = page.meta.sources[key].label;
      if (labels.indexOf(label) === -1) labels.push(label);
    });
  });
  document.getElementById("source-line").textContent =
    (labels.length ? "Sources: " + labels.join("; ") + ". " : "") + "Projection: this tool's model.";
  document.getElementById("coverage-line").textContent =
    country.governmentCovered + " " + country.yearBasis +
    " Defaults marked illustrative are starting values, not estimates.";
}

// ---------------------------------------------------------------- download

function downloadCsv() {
  var country = page.data[page.country];
  var definition = currentChart();
  var table = chartTable(definition);
  var values = page.controls[page.country];

  function cell(text) {
    text = String(text);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  var lines = [
    "# Sovereign debt simulator. A scenario tool, not a forecast and not financial advice.",
    "# " + country.name + ": " + definition.title,
    "# Control values that produced these series:"
  ];
  Object.keys(values).forEach(function (key) {
    lines.push("# " + key + "," + values[key]);
  });
  lines.push(["year", "history or projection"].concat(table.series.map(function (s) {
    return s.label + (s.unit === "%" ? " (%)" : "");
  })).map(cell).join(","));
  table.years.forEach(function (year, i) {
    var row = [year, i <= table.startIndex ? "history" : "projection"];
    table.series.forEach(function (s) {
      row.push(s.values[i] === null ? "" : s.values[i].toFixed(4));
    });
    lines.push(row.join(","));
  });

  var link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
  link.download = page.country + "-" + definition.key + ".csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

// ---------------------------------------------------------------- the page address

// The full set of control values is kept in the page address, so a
// scenario can be shared as a link.
function writeAddress() {
  var params = new URLSearchParams();
  var code = COUNTRIES.filter(function (c) { return c.key === page.country; })[0].code;
  params.set("c", code);
  params.set("chart", page.chart);
  params.set("range", page.range);
  var values = page.controls[page.country];
  Object.keys(values).forEach(function (key) {
    var v = values[key];
    params.set(key, typeof v === "boolean" ? (v ? "1" : "0") : v);
  });
  history.replaceState(null, "", "?" + params.toString());
}

function readAddress() {
  var params = new URLSearchParams(location.search);
  var match = COUNTRIES.filter(function (c) { return c.code === params.get("c"); })[0];
  if (match && page.data[match.key]) page.country = match.key;
  if (params.get("chart")) page.chart = params.get("chart");
  if (["10", "20", "30"].indexOf(params.get("range")) !== -1) page.range = Number(params.get("range"));

  var country = page.data[page.country];
  var values = page.controls[page.country];
  controlList(country).forEach(function (control) {
    var text = params.get(control.key);
    if (text === null) return;
    var preset = presetFor(control, country);
    if (control.type === "range") {
      var number = parseFloat(text);
      if (isFinite(number)) values[control.key] = snap(number, preset);
    } else if (control.type === "check") {
      values[control.key] = text === "1";
    } else if (control.options.some(function (o) { return o[0] === text; })) {
      values[control.key] = text;
    }
  });
}

// ---------------------------------------------------------------- putting it together

// Runs after every change: recompute, redraw, and update the address.
function update() {
  var country = page.data[page.country];
  var inputs = modelInputs(country, page.controls[page.country]);
  page.result = runModel(inputs.start, inputs.controls);
  showOrHideControls();
  fillText();
  draw();
  writeAddress();
}

function showCountry(key) {
  page.country = key;
  document.querySelectorAll("#country-tabs button").forEach(function (button) {
    button.setAttribute("aria-pressed", button.dataset.country === key ? "true" : "false");
  });
  var select = document.getElementById("chart-select");
  select.textContent = "";
  chartList(page.data[key]).forEach(function (chart) {
    var option = document.createElement("option");
    option.value = chart.key;
    option.textContent = chart.title;
    select.append(option);
  });
  page.chart = currentChart().key;
  select.value = page.chart;
  buildControls();
  update();
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.getElementById("theme-toggle").textContent = theme === "dark" ? "Light theme" : "Dark theme";
  try {
    localStorage.setItem("tracker-theme", theme); // the only thing the page stores
  } catch (error) {
    // Storage can be blocked. The theme then lasts until the page closes.
  }
}

function setRange(range) {
  page.range = range;
  document.querySelectorAll(".range button").forEach(function (button) {
    button.setAttribute("aria-pressed", Number(button.dataset.range) === range ? "true" : "false");
  });
}

function getJson(path) {
  return fetch(path).then(function (response) {
    if (!response.ok) throw new Error("Could not load " + path);
    return response.json();
  });
}

function startPage() {
  var stored = null;
  try {
    stored = localStorage.getItem("tracker-theme");
  } catch (error) {
    // Storage can be blocked.
  }
  setTheme(stored === "dark" ? "dark" : "light");

  Promise.all([getJson("data/presets.json"), getJson("data/meta.json")]).then(function (files) {
    page.presets = files[0];
    page.meta = files[1];
    // Only countries the last build marked available are loaded.
    var available = COUNTRIES.filter(function (c) {
      return page.meta.countries[c.key] && page.meta.countries[c.key].available;
    });
    return Promise.all(available.map(function (c) {
      return getJson("data/" + c.key + ".json").then(function (data) {
        page.data[c.key] = data;
        page.controls[c.key] = defaultControls(data);
      });
    }));
  }).then(function () {
    var tabs = document.getElementById("country-tabs");
    COUNTRIES.forEach(function (c) {
      var button = document.createElement("button");
      button.type = "button";
      button.dataset.country = c.key;
      if (page.data[c.key]) {
        button.textContent = c.name;
        button.addEventListener("click", function () { showCountry(c.key); });
      } else {
        button.textContent = c.name + " (unavailable)";
        button.disabled = true;
      }
      tabs.append(button);
    });

    page.country = Object.keys(page.data)[0];
    if (!page.country) throw new Error("No country data is available");
    readAddress();
    setRange(page.range);
    showCountry(page.country);

    document.getElementById("chart-select").addEventListener("change", function (event) {
      page.chart = event.target.value;
      update();
    });
    document.querySelectorAll(".range button").forEach(function (button) {
      button.addEventListener("click", function () {
        setRange(Number(button.dataset.range));
        update();
      });
    });
    document.getElementById("theme-toggle").addEventListener("click", function () {
      setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
      draw();
    });
    document.getElementById("download").addEventListener("click", downloadCsv);
    document.getElementById("reset").addEventListener("click", function () {
      page.controls[page.country] = defaultControls(page.data[page.country]);
      buildControls();
      update();
    });

    var waiting = false;
    window.addEventListener("resize", function () {
      if (waiting) return;
      waiting = true;
      requestAnimationFrame(function () {
        waiting = false;
        draw();
      });
    });
  }).catch(function (error) {
    document.getElementById("chart").textContent = "The simulator could not start: " + error.message;
  });
}

startPage();
