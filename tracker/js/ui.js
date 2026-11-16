// Sovereign debt simulator: the page.
//
// This file loads the data files, builds the controls, runs the model
// whenever a control changes, and hands the results to charts.js.
// Every default and range comes from the data files, not from this file.

var COUNTRIES = [
  { key: "united-states", code: "us", name: "United States" },
  { key: "japan", code: "jp", name: "Japan" },
  { key: "canada", code: "ca", name: "Canada" }
];
// The United Kingdom is left out for now. Its data file is still built;
// to show it again, add this line back to the list above:
//   { key: "united-kingdom", code: "uk", name: "United Kingdom" },
// (The United Kingdom also needs an M2 series in its data file first:
// inflation on this page follows the money supply.)

var GROUP_LABELS = {
  domesticPrivate: "Domestic private",
  domestic: "Domestic",
  foreignOfficial: "Foreign official",
  foreignPrivate: "Foreign private",
  foreign: "Foreign"
};

// Everything the page remembers while it is open.
var page = {
  presets: null,
  estimates: null,
  meta: null,
  data: {},        // country key -> its data file
  controls: {},    // country key -> that country's current control values
  country: null,   // the country being shown
  plots: [],       // the uPlot objects on screen, one per chart
  zoom: null,      // the years shown when the reader has zoomed in: { min, max }
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
// goes: main, scenario or advanced. `help` is shown behind the "i" button,
// followed by where the default comes from. Two more flags:
//   boxed   one of the two settings that matter most, shown first in a box
//   hidden  not shown, because it moves the result little; the model still
//           uses its default
function controlList(country) {
  var list = [
    { key: "primaryBalance", section: "main", type: "range", format: "percent1", boxed: true,
      label: "Primary balance",
      help: "Held constant for the whole projection." },
    // Hidden: M2 reacts to what the central bank buys, so its underlying
    // growth stays at the country's past average.
    { key: "moneyGrowth", section: "main", type: "range", format: "percent1", hidden: true,
      label: "Money supply growth",
      help: "M2 growth before any money created by central bank purchases." },
    { key: "growth", section: "main", type: "range", format: "percent1", boxed: true,
      label: "Real growth",
      help: "Held constant for the whole projection." },
    { key: "stressInterestShare", section: "main", type: "range", format: "percent0",
      label: "Fiscal stress threshold",
      help: "Interest-to-revenue ratio above which a year counts as fiscal stress. Revenue is held at its starting share of GDP." },
    { key: "capMode", section: "main", type: "choice",
      label: "Yield cap",
      help: "The central bank buys whatever debt it takes to hold the 10-year yield at the cap, up to its limit. Stress level: the yield at which interest would equal the fiscal stress threshold once the whole debt pays that yield, recomputed annually from that year's debt, so it falls as debt grows. Fixed: a set level. Off: no purchases beyond keeping its share of the debt.",
      options: [
        ["stress", "Stress level"],
        ["fixed", "Fixed"],
        ["off", "Off"]
      ],
      // Shown under the buttons, so the level in force is always stated.
      note: function (c) {
        if (c.capMode === "off") return "No cap. The central bank never buys to hold the yield down.";
        if (c.capMode === "fixed") return "Capped at " + FORMATS.percent1(c.capLevel) + ".";
        // The level moves with the debt, so it is read from the projection.
        var rows = page.result ? page.result.rows : [];
        var first = rows[1];
        var last = rows[rows.length - 1];
        if (!first || first.cap === null || last.cap === null) return "";
        var a = FORMATS.percent1(first.cap);
        var b = FORMATS.percent1(last.cap);
        return "Capped at " + a + " in " + first.year +
          (a === b ? ", and still " + b + " in " : last.cap > first.cap ? ", rising to " + b + " by " : ", falling to " + b + " by ") +
          last.year + ". Each year it is the yield at which interest would take " +
          FORMATS.percent0(c.stressInterestShare) + " of revenue, the fiscal stress threshold, once the whole debt pays that yield.";
      } },
    { key: "capLevel", section: "main", type: "range", format: "percent1", indent: true,
      showWhen: function (c) { return c.capMode === "fixed"; },
      label: "Cap level",
      help: "" },
    { key: "centralBankLimit", section: "main", type: "range", format: "percent0", indent: true,
      showWhen: function (c) { return c.capMode !== "off"; },
      label: "Central bank limit",
      help: "Maximum central bank share of the debt. At the limit purchases stop and the cap no longer binds." }
  ];

  // A selloff by all holders abroad. Where the data separates foreign
  // official from foreign private holders, both sell the same share.
  list.push(
    { key: "selloffOn", section: "scenario", type: "check",
      label: "Foreign selloff",
      help: "All foreign holders sell the same share of their holdings, spread evenly over the period." },
    { key: "selloffShare", section: "scenario", type: "range", format: "percent0", indent: true,
      showWhen: function (c) { return c.selloffOn; },
      label: "Share sold", help: "" },
    { key: "selloffYears", section: "scenario", type: "range", format: "years0", indent: true,
      showWhen: function (c) { return c.selloffOn; },
      label: "Over", help: "" },
    { key: "selloffResponse", section: "scenario", type: "range", format: "basisPoints", indent: true,
      showWhen: function (c) { return c.selloffOn; },
      label: "Yield rise from selling",
      help: "Extra basis points of yield per point of GDP sold and not yet bought by the central bank, on top of the yield response. It fades as the market absorbs the sale: half of what is left each year." }
  );

  // Advanced settings: these move the result less.
  list.push(
    // Hidden: it changes how quickly inflation reaches the rate money
    // growth implies, which barely moves a 30-year result.
    { key: "persistence", section: "advanced", type: "range", format: "number2", hidden: true,
      label: "Inflation persistence",
      help: "Share of last year's gap between inflation and the money-implied rate that carries into this year." },
    { key: "moneyShare", section: "advanced", type: "range", format: "number2",
      label: "New money from central bank buying",
      help: "M2 created per unit of debt the central bank buys, both as shares of GDP." },
    { key: "moneyTrend", section: "advanced", type: "range", format: "percent1",
      label: "Money growth that does not raise prices",
      help: "Trend rise in M2 relative to GDP that does not raise prices (falling velocity)." }
  );
  Object.keys(country.start.holdings).forEach(function (group) {
    list.push({ key: "w_" + group, section: "advanced", type: "range", format: "percent0", hidden: true,
      label: "Price-sensitive share: " + GROUP_LABELS[group].toLowerCase(),
      help: "Share of this group's holdings that demands a higher yield to absorb more debt." });
  });
  list.push(
    { key: "yieldResponse", section: "advanced", type: "range", format: "basisPoints",
      label: "Yield response",
      help: "Basis points of yield per point of GDP of debt that price-sensitive holders must absorb. It works both ways: debt the central bank takes off the market lowers the yield at the same rate, so with the yield cap on, a higher value can mean lower yields." },
    { key: "runoff", section: "advanced", type: "range", format: "percent1", hidden: true,
      label: "Central bank runoff",
      help: "Annual decline in central bank holdings, as a share of GDP." },
    { key: "maturity", section: "advanced", type: "range", format: "years1", hidden: true,
      label: "Average maturity",
      help: "One-over-maturity of the debt reprices at the current yield each year." }
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
  var preset = Object.assign({}, page.presets.controls[control.key] || {});
  var start = country.start;
  // Defaults taken from the data files, each with a note saying where from.
  var fromData = {
    growth: start.growth,                          // the IMF's projection
    primaryBalance: start.baselinePrimaryBalance,  // the recent average
    moneyGrowth: start.moneyGrowth,
    moneyTrend: start.moneyTrend,
    maturity: start.maturity,
    moneyShare: page.estimates.moneyShare          // estimated across countries
  }[control.key];
  if (fromData) {
    preset.default = fromData.value;
    preset.basis = "Default: " + fromData.note + ".";
  }
  if (control.key === "stressInterestShare") {
    // Shown beside the assumption so the reader can place it: what the
    // country pays now, as average rate x debt / revenue.
    var now = start.averageRate.value * start.debt.value / start.revenue.value;
    preset.basis = preset.basis + " In " + start.year + " interest takes about " +
      FORMATS.percent0(now) + " of revenue.";
  }
  if (control.key === "centralBankLimit") {
    // The limit cannot be set below what the central bank already holds.
    var share = start.centralBank.value / start.debt.value;
    while (preset.min < share && preset.min + preset.step <= preset.max) {
      preset.min = parseFloat((preset.min + preset.step).toFixed(6));
    }
    preset.basis = preset.basis + " In " + start.year + " this central bank holds " +
      FORMATS.percent0(share) + ".";
  }
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

// A small round button and the explanation it shows or hides. Returns
// both, so the caller can place them.
function infoButton(text, label) {
  var button = document.createElement("button");
  button.type = "button";
  button.className = "info";
  button.textContent = "i";
  button.setAttribute("aria-label", "About: " + label);
  button.setAttribute("aria-expanded", "false");
  var tip = document.createElement("p");
  tip.className = "tip";
  tip.textContent = text;
  tip.hidden = true;
  button.addEventListener("click", function (event) {
    event.preventDefault();   // inside a label, do not also press its control
    var show = tip.hidden;
    closeTips();
    tip.hidden = !show;
    button.setAttribute("aria-expanded", String(show));
  });
  return { button: button, tip: tip };
}

// Closes every open explanation.
function closeTips() {
  document.querySelectorAll(".tip").forEach(function (tip) { tip.hidden = true; });
  document.querySelectorAll(".info[aria-expanded]").forEach(function (button) {
    if (button.id !== "warning-why") button.setAttribute("aria-expanded", "false");
  });
}

// Colors the part of a slider's track below its value.
function fillTrack(input) {
  var share = (input.value - input.min) / (input.max - input.min);
  input.style.setProperty("--fill", (share * 100).toFixed(1) + "%");
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
    if (control.hidden) return;
    var preset = presetFor(control, country);
    var id = "control-" + control.key;
    var box = document.createElement("div");
    box.className = "control" + (control.type === "check" ? " check" : "") + (control.indent ? " indent" : "") +
      (control.boxed ? " key-control" : "");
    box.dataset.key = control.key;

    // The first line: the label, the "i" button and the current value.
    var head = document.createElement("div");
    head.className = "control-head";
    var label = document.createElement("label");
    label.htmlFor = id;
    // The explanation: what the control does, then where its default
    // comes from.
    var info = infoButton([control.help, preset.basis].filter(Boolean).join(" "), control.label);
    box.append(head, info.tip);

    if (control.type === "range") {
      var input = document.createElement("input");
      input.type = "range";
      input.id = id;
      input.min = preset.min;
      input.max = preset.max;
      input.step = preset.step;
      input.value = values[control.key];
      fillTrack(input);
      var output = document.createElement("output");
      output.htmlFor = id;
      output.textContent = FORMATS[control.format](values[control.key]);
      label.textContent = control.label;
      head.append(label, info.button, output);
      input.addEventListener("input", function () {
        values[control.key] = parseFloat(input.value);
        output.textContent = FORMATS[control.format](values[control.key]);
        fillTrack(input);
        update();
      });

      // Under the slider: its lowest value, its default, its highest.
      var ends = document.createElement("div");
      ends.className = "range-ends";
      var defaultValue = snap(preset.default, preset);
      [FORMATS[control.format](preset.min),
        "Default " + FORMATS[control.format](defaultValue) + (preset.illustrative ? " (illustrative)" : ""),
        FORMATS[control.format](preset.max)].forEach(function (text) {
        var span = document.createElement("span");
        span.textContent = text;
        ends.append(span);
      });
      box.append(input, ends);
    } else if (control.type === "choice") {
      // A row of buttons, one pressed.
      var group = document.createElement("div");
      group.className = "segmented";
      group.id = id;
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", control.label);
      control.options.forEach(function (option) {
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = option[1];
        button.setAttribute("aria-pressed", String(values[control.key] === option[0]));
        button.addEventListener("click", function () {
          values[control.key] = option[0];
          group.querySelectorAll("button").forEach(function (other) {
            other.setAttribute("aria-pressed", String(other === button));
          });
          update();
        });
        group.append(button);
      });
      // A group of buttons has no single control for a label to point at.
      var name = document.createElement("label");
      name.textContent = control.label;
      head.append(name, info.button);
      box.append(group);
      if (control.note) {
        var note = document.createElement("p");
        note.className = "control-note";
        box.append(note);
        box.note = function (current) { note.textContent = control.note(current); };
      }
    } else {
      // An on-off switch.
      var check = document.createElement("input");
      check.type = "checkbox";
      check.id = id;
      check.checked = values[control.key];
      label.append(check, control.label);
      head.append(label, info.button);
      check.addEventListener("change", function () {
        values[control.key] = check.checked;
        update();
      });
    }

    box.showWhen = control.showWhen;
    // A heading between the key settings and the rest.
    if (control.section === "main" && !control.boxed && !sections.main.querySelector("h3")) {
      var heading = document.createElement("h3");
      heading.textContent = "Other settings";
      sections.main.append(heading);
    }
    sections[control.section].append(box);
  });
  showOrHideControls();
}

// Some controls only apply when another is switched on.
function showOrHideControls() {
  var values = page.controls[page.country];
  document.querySelectorAll(".control").forEach(function (box) {
    box.hidden = box.showWhen ? !box.showWhen(values) : false;
    if (box.note) box.note(values);
  });
  // Reset has nothing to do while every setting is at its default.
  var defaults = defaultControls(page.data[page.country]);
  document.getElementById("reset").disabled = Object.keys(defaults).every(function (key) {
    return defaults[key] === values[key];
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
    // Every foreign group sells the same share of its holdings.
    Object.keys(holdings).forEach(function (group) {
      if (group.indexOf("foreign") === 0) {
        selloffs.push({ group: group, total: c.selloffShare * holdings[group], years: c.selloffYears });
      }
    });
  }

  return {
    start: {
      year: s.year,
      debt: value(s.debt),
      centralBank: value(s.centralBank),
      money: value(s.money),
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
      stressInterestShare: c.stressInterestShare,
      capMode: c.capMode,
      capLevel: c.capLevel,
      centralBankLimit: c.centralBankLimit,
      priceSensitive: priceSensitive,
      yieldResponse: c.yieldResponse,
      moneyGrowth: c.moneyGrowth,
      moneyShare: c.moneyShare,
      moneyTrend: c.moneyTrend,
      persistence: c.persistence,
      maturity: c.maturity,
      runoff: c.runoff,
      selloffs: selloffs,
      selloffResponse: c.selloffResponse
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

// The two charts, shown side by side. `key` names the box it is drawn in
// (chart-debt, chart-yields) and `sources` the data series the source line
// names. Each line says where its history comes from (`history`, a function
// of the year) and its projection (`projection`, a function of the model's
// row for that year).
function chartList(country) {
  function history(name, scale) {
    return function (year) {
      var v = historyValue(country, name, year);
      return v === null ? null : v * scale;
    };
  }

  return [
    { key: "debt", unit: "%", decimals: 0,
      sources: ["debt"],
      series: [
        { label: "Debt", color: 1, unit: "%", decimals: 1,
          history: history("debt", 100), projection: function (row) { return row.debt * 100; } }
      ] },

    { key: "yields", unit: "%", decimals: 1,
      sources: ["yield", "averageRate"],
      series: [
        { label: "10-year yield", color: 1, unit: "%", decimals: 2,
          history: history("yield", 100), projection: function (row) { return row.yield * 100; } },
        // Grey and dotted, so it cannot be mistaken for the black line.
        { label: "Average interest rate on the debt", color: 2, unit: "%", decimals: 2, width: 2.5, dotted: true,
          history: history("averageRate", 100), projection: function (row) { return row.averageRate * 100; } }
      ] }
  ];
}

// The loss of purchasing power if the central bank's buying created no
// money: the same scenario run again with that one setting at zero.
function lossWithoutNewMoney(country, c) {
  var inputs = modelInputs(country, Object.assign({}, c, { moneyShare: 0 }));
  return runModel(inputs.start, inputs.controls).headline.purchasingPowerLoss;
}

// The years and values of one chart, ready to plot.
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
    return Object.assign({}, s, { values: values });
  });
  return { years: years, startIndex: startIndex, series: series };
}

// Draws both charts, each in its own box. Only fiscal stress is shaded;
// fiscal dominance has its own card.
function draw() {
  var stressYears = page.result.rows.filter(function (row) { return row.stress; }).map(function (row) {
    return row.year;
  });

  page.plots.forEach(function (plot) { plot.destroy(); });
  page.plots = chartList(page.data[page.country]).map(function (definition) {
    var table = chartTable(definition);
    var startYear = table.years[table.startIndex];
    return drawChart(document.getElementById("chart-" + definition.key), Object.assign({}, definition, table, {
      stressYears: stressYears,
      // Half as many years of history as years projected
      xMin: Math.max(table.years[0], startYear - page.presets.years / 2),
      xMax: startYear + page.presets.years,
      zoom: page.zoom,
      syncKey: "tracker",   // one crosshair across both charts
      onZoom: zoomTo
    }));
  });
}

// Both charts show the same years. A zoom in one is copied to the other,
// and kept while settings change. Nulls show the whole period again.
function zoomTo(min, max) {
  var wasZoomed = page.zoom !== null;
  page.zoom = min === null ? null : { min: min, max: max };
  document.getElementById("zoom-reset").hidden = page.zoom === null;
  if (page.zoom === null) {
    if (wasZoomed) draw();
    return;
  }
  page.plots.forEach(function (plot) {
    if (plot.scales.x.min !== min || plot.scales.x.max !== max) plot.setScale("x", { min: min, max: max });
  });
}

// ---------------------------------------------------------------- the text around the chart

function fillText() {
  var country = page.data[page.country];
  var h = page.result.headline;

  document.getElementById("chart-title").textContent = country.name;
  var flag = document.getElementById("flag");
  flag.src = "img/flag-" + country.country + ".png";
  flag.alt = "Flag of " + (country.country === "united-states" ? "the " : "") + country.name;
  flag.hidden = false;
  document.getElementById("chart-meta").textContent =
    "Starting year " + country.start.year +
    " · Data updated " + page.meta.lastSuccessfulRun +
    " · Annual";

  fillStats();
  fillHow();

  var warning = document.getElementById("warning");
  warning.hidden = h.firstCapBrokenYear === null;
  if (h.firstCapBrokenYear !== null) {
    var rows = page.result.rows;
    var firstBought = rows.filter(function (row) { return row.purchases > 0; })[0];
    var broken = rows.filter(function (row) { return row.year === h.firstCapBrokenYear; })[0];
    var share = FORMATS.percent0(broken.centralBank / broken.debt);
    document.getElementById("warning-text").textContent = "From " + h.firstCapBrokenYear +
      " the central bank owns " + share + " of the government's debt, the most it will hold, " +
      "and can no longer hold interest rates down.";
    // The longer explanation, shown when the question mark is pressed.
    document.getElementById("warning-more").textContent =
      (firstBought && firstBought.year < h.firstCapBrokenYear
        ? "Purchases to hold the cap start in " + firstBought.year + ". By " + h.firstCapBrokenYear +
          " the central bank reaches its limit of " + share + " of the debt with the market yield still above the cap (" +
          FORMATS.percent1(broken.cap) + "), and stops buying. "
        : "Holding the cap (" + FORMATS.percent1(broken.cap) + ") in " + h.firstCapBrokenYear +
          " would take the central bank past its limit of " + share + " of the debt, so it stops there. ") +
      "From then on the cap does not bind and the chart shows the market yield.";
  }

  // The source line names the publisher and series behind the history of
  // both charts.
  var labels = [];
  chartList(country).forEach(function (definition) {
    definition.sources.forEach(function (name) {
      (country.history[name] ? country.history[name].source : []).forEach(function (source) {
        var label = page.meta.sources[source].label;
        if (labels.indexOf(label) === -1) labels.push(label);
      });
    });
  });
  document.getElementById("source-line").textContent =
    "Sources: " + labels.join("; ") + ". Projection: this tool's model.";
  document.getElementById("coverage-line").textContent =
    country.governmentCovered + " " + country.yearBasis + " " +
    (country.notes || []).join(" ") +
    " Defaults marked illustrative are starting values for exploring scenarios, not estimates.";
}

// A total loss of purchasing power as a steady yearly rate.
function annualLoss(loss, years) {
  return 1 - Math.pow(1 - loss, 1 / years);
}

// The headline figures, one card each.
function fillStats() {
  var country = page.data[page.country];
  var c = page.controls[page.country];
  var h = page.result.headline;
  var rows = page.result.rows;
  var first = rows[0];
  var last = rows[rows.length - 1];
  var span = first.year + " to " + last.year;
  var threshold = country.start.stressThreshold.value;

  var stats = [
    { label: "Currency debasement",
      value: FORMATS.percent1(annualLoss(h.purchasingPowerLoss, rows.length - 1)), unit: "annually",
      note: FORMATS.percent0(h.purchasingPowerLoss) + " in total by " + last.year,
      tip: "Loss of purchasing power, " + span + ", annualized: 1 − 1 ÷ price level." },
    { label: "Money supply expansion",
      value: FORMATS.percent1(h.annualMoneyGrowth), unit: "annually",
      note: "M2, " + span,
      tip: "M2 growth, " + span + ", annualized." },
    { label: "Debt in " + last.year,
      value: FORMATS.percent0(h.finalDebt), unit: "of GDP",
      note: FORMATS.percent0(first.debt) + " in " + first.year,
      tip: country.governmentCovered },
    { label: "Fiscal stress", kind: h.firstStressYear ? "alert" : "",
      value: h.firstStressYear || "Not reached",
      note: h.firstStressYear ? "first year" : "by " + last.year,
      tip: "First year interest exceeds " + FORMATS.percent0(c.stressInterestShare) + " of revenue" +
        (typeof threshold === "number"
          ? ", or the debt-stabilizing primary balance exceeds " + FORMATS.percent1(threshold) +
            " of GDP, the " + country.start.stressThreshold.note + "."
          : ".") },
    { label: "Fiscal dominance", kind: h.firstDominanceYear ? "alert" : "",
      value: h.firstDominanceYear || "Not reached",
      note: h.firstDominanceYear ? "first year" : "by " + last.year,
      tip: c.capMode === "off"
        ? "First year the central bank buys debt to hold the 10-year yield at its cap. The cap is off."
        : "First year the central bank buys debt to hold the 10-year yield at its cap." },
    { label: "Central bank share",
      value: FORMATS.percent0(h.peakCentralBankShare), unit: "at its peak",
      note: FORMATS.percent0(first.centralBank / first.debt) + " in " + first.year,
      tip: "Peak central bank share of the debt, " + span + "." }
  ];

  var box = document.getElementById("stats");
  box.textContent = "";
  stats.forEach(function (stat) {
    var card = document.createElement("div");
    card.className = "card stat" + (stat.kind ? " " + stat.kind : "");
    var info = infoButton(stat.tip, stat.label);

    var label = document.createElement("div");
    label.className = "stat-label";
    // The button stays on the same line as the label's last word.
    var cut = stat.label.lastIndexOf(" ") + 1;
    var lastWord = document.createElement("span");
    lastWord.className = "together";
    lastWord.append(stat.label.slice(cut), info.button);
    label.append(stat.label.slice(0, cut), lastWord);

    var value = document.createElement("div");
    // Words are set smaller than figures, so "Not reached" fits on one line.
    value.className = "stat-value" + (typeof stat.value === "string" && !/\d/.test(stat.value) ? " words" : "");
    value.textContent = stat.value;
    if (stat.unit) {
      var unit = document.createElement("small");
      unit.textContent = stat.unit;
      value.append(unit);
    }

    var note = document.createElement("div");
    note.className = "stat-note";
    note.textContent = stat.note;

    card.append(label, value, note, info.tip);
    box.append(card);
  });
}

// The steps behind the two central figures, with this scenario's numbers.
function fillHow() {
  var country = page.data[page.country];
  var c = page.controls[page.country];
  var rows = page.result.rows;
  var last = rows[rows.length - 1];
  var years = rows.length - 1;
  var startYear = country.start.year;
  var loss = page.result.headline.purchasingPowerLoss;
  // The same loss as a steady yearly rate: losing this much every year
  // for the whole period adds up to the total.
  var lossPerYear = annualLoss(loss, years);
  var moneyTimes = page.result.headline.moneyTimes;
  var moneyPerYear = page.result.headline.annualMoneyGrowth;

  var lossWithout = lossWithoutNewMoney(country, c);
  var impliedInflation = (1 + c.moneyGrowth) / ((1 + c.growth) * (1 + c.moneyTrend)) - 1;
  var averageInflation = Math.pow(last.priceLevel, 1 / years) - 1;
  var capYears = rows.filter(function (row) { return row.purchases > 0; });
  var capPurchases = 0;
  capYears.forEach(function (row) { capPurchases += row.purchases; });
  var totalRise = last.centralBank - rows[0].centralBank;

  var steps = [
    "1. Currency debasement is the loss of purchasing power: 1 − 1 ÷ price level. The price level in " + last.year + " is " +
      last.priceLevel.toFixed(2) + " times its " + startYear + " level, so the loss is 1 − 1 ÷ " +
      last.priceLevel.toFixed(2) + " = " + FORMATS.percent0(loss) + ". As a steady yearly rate that is " +
      FORMATS.percent1(lossPerYear) + " annually: 1 − (1 − " + FORMATS.percent0(loss) + ") ^ (1 ÷ " + years + ").",
    "2. Inflation averages " +
      FORMATS.percent1(averageInflation) + " annually over the " + years + " years.",
    "3. Inflation follows the money supply. Without central bank buying, money grows at " +
      FORMATS.percent1(c.moneyGrowth) + " annually (the " + country.start.moneyGrowth.note +
      "). Money growing at that rate, with real growth of " + FORMATS.percent1(c.growth) + " and " + FORMATS.percent1(c.moneyTrend) +
      " of money growth that does not raise prices, implies inflation of " + FORMATS.percent1(impliedInflation) +
      ": (1 + " + FORMATS.percent1(c.moneyGrowth) + ") ÷ ((1 + " + FORMATS.percent1(c.growth) + ") × (1 + " +
      FORMATS.percent1(c.moneyTrend) + ")) − 1. Each year inflation moves toward the rate that last year's money growth implies, and " +
      "persistence (" + c.persistence.toFixed(2) + ") is the part of the gap that remains.",
    "4. The central bank keeps its share of the debt, so its holdings rise when debt grows faster than " +
      "the economy. It buys more in years when the yield would otherwise rise above its cap, up to its limit. " +
      "In this scenario its holdings " + (totalRise >= 0 ? "rise" : "fall") + " by " +
      FORMATS.percent0(Math.abs(totalRise)) + " of GDP over the " + years + " years" +
      (capYears.length
        ? ", of which " + FORMATS.percent0(capPurchases) + " of GDP is bought to hold the cap, starting in " +
          capYears[0].year + "."
        : c.capMode === "off" ? ". The cap is off." : ". The cap is never reached."),
    "5. Each unit of debt the central bank adds to its holdings, as a share of GDP, creates " +
      c.moneyShare.toFixed(2) + " units of new money, on top of the " + FORMATS.percent1(c.moneyGrowth) +
      " annually. Holdings that only shrink against a growing economy, with nothing sold, destroy no money. " +
      "If its buying created no money, the loss would be " + FORMATS.percent1(lossWithout) +
      " instead of " + FORMATS.percent1(loss) + ".",
    "6. M2 is " + FORMATS.percent0(rows[0].money) +
      " of GDP in " + startYear + " and " + FORMATS.percent0(last.money) + " of GDP in " + last.year +
      ". Over the " + years + " years it becomes " + moneyTimes.toFixed(1) + " times as large: " +
      FORMATS.percent1(moneyPerYear) + " annually.",
    "7. Debt, as a share of GDP: debt = last year's debt × (1 + average interest rate) ÷ (1 + nominal growth) − primary balance. " +
      "It goes from " + FORMATS.percent0(rows[0].debt) + " of GDP in " + startYear + " to " + FORMATS.percent0(last.debt) +
      " in " + last.year + ", with a primary balance of " + FORMATS.percent1(c.primaryBalance) + " of GDP.",
    "8. The average interest rate follows the 10-year yield as the debt rolls over: each year 1 ÷ " +
      c.maturity.toFixed(1) + " of the debt (the average maturity in years) reprices at last year's 10-year yield. " +
      "It goes from " + FORMATS.percent1(rows[0].averageRate) + " in " + startYear + " to " + FORMATS.percent1(last.averageRate) +
      " in " + last.year + ".",
    "9. The 10-year yield starts at " + FORMATS.percent1(rows[0].yield) + " and moves one for one with the change in inflation. " +
      "It also rises " + (c.yieldResponse * 100).toFixed(1) + " basis points for each point of GDP of debt that price-sensitive holders " +
      "must hold beyond their " + startYear + " holdings, and falls the same way when the central bank takes debt off the market." +
      (c.selloffOn ? " A selloff adds " + (c.selloffResponse * 100).toFixed(0) + " basis points for each point of GDP sold and not yet absorbed." : ""),
    "10. " + (c.capMode === "off"
      ? "The yield cap is off, so the yield is always the rate lenders ask for."
      : "When the yield lenders ask for is above the cap, the central bank buys debt until the yield is back at the cap, up to its limit of " +
        FORMATS.percent0(c.centralBankLimit) + " of the debt. Its purchases create money (step 5), which raises inflation and so the yield " +
        "lenders ask for: holding a cap gets harder the longer it lasts." +
        (page.result.headline.firstCapBrokenYear
          ? " In this scenario it reaches its limit in " + page.result.headline.firstCapBrokenYear + ", and the cap no longer holds."
          : capYears.length ? " In this scenario the cap holds throughout." : " In this scenario the cap is never reached."))
  ];

  var body = document.getElementById("how-body");
  body.textContent = "";
  steps.forEach(function (text) {
    var paragraph = document.createElement("p");
    paragraph.textContent = text;
    body.append(paragraph);
  });

  // Every fifth year, so the steps can be checked against the numbers.
  var table = document.createElement("table");
  var head = table.insertRow();
  ["Year", "Inflation", "Money growth", "Central bank holdings, share of GDP", "Price level", "What 100 buys"].forEach(function (text) {
    var cell = document.createElement("th");
    cell.textContent = text;
    head.append(cell);
  });
  rows.forEach(function (row, t) {
    if (t % 5 !== 0) return;
    var line = table.insertRow();
    [row.year, FORMATS.percent1(row.inflation), FORMATS.percent1(row.moneyGrowth), FORMATS.percent1(row.centralBank),
      row.priceLevel.toFixed(2), (100 / row.priceLevel).toFixed(0)].forEach(function (text) {
      line.insertCell().textContent = text;
    });
  });
  var scroll = document.createElement("div");
  scroll.className = "table-scroll";
  scroll.append(table);
  body.append(scroll);
}

// ---------------------------------------------------------------- the page address

// The full set of control values is kept in the page address, so a
// scenario can be shared as a link.
function writeAddress() {
  var params = new URLSearchParams();
  var code = COUNTRIES.filter(function (c) { return c.key === page.country; })[0].code;
  params.set("c", code);
  var values = page.controls[page.country];
  var hidden = {};
  controlList(page.data[page.country]).forEach(function (control) { hidden[control.key] = control.hidden; });
  Object.keys(values).forEach(function (key) {
    if (hidden[key]) return;
    var v = values[key];
    params.set(key, typeof v === "boolean" ? (v ? "1" : "0") : v);
  });
  try {
    history.replaceState(null, "", "?" + params.toString());
  } catch (error) {
    // Some browsers refuse when the address changes too often. The page
    // works without it; only the shareable link is behind.
  }
}

// Browsers limit how often the address may change, and a dragged slider
// changes many times a second. So the address is written once the
// changes pause.
var addressTimer = null;
function writeAddressSoon() {
  clearTimeout(addressTimer);
  addressTimer = setTimeout(writeAddress, 250);
}

function readAddress() {
  var params = new URLSearchParams(location.search);
  var match = COUNTRIES.filter(function (c) { return c.code === params.get("c"); })[0];
  if (match && page.data[match.key]) page.country = match.key;

  var country = page.data[page.country];
  var values = page.controls[page.country];
  controlList(country).forEach(function (control) {
    var text = params.get(control.key);
    if (text === null || control.hidden) return;
    var preset = presetFor(control, country);
    if (control.type === "range") {
      var number = parseFloat(text);
      if (isFinite(number)) values[control.key] = snap(number, preset);
    } else if (control.type === "check") {
      values[control.key] = text === "1";
    } else if (control.type === "choice" && control.options.some(function (o) { return o[0] === text; })) {
      values[control.key] = text;
    }
  });
}

// ---------------------------------------------------------------- putting it together

// Runs after every change: recompute, redraw, and update the address.
function update() {
  var error = document.getElementById("error");
  try {
    var country = page.data[page.country];
    var inputs = modelInputs(country, page.controls[page.country]);
    page.result = runModel(inputs.start, inputs.controls);
    showOrHideControls();
    fillText();
    draw();
    error.hidden = true;
  } catch (problem) {
    // Never leave the page showing figures that do not match the settings
    // without saying so.
    error.textContent = "These settings could not be calculated (" + problem.message +
      "). The figures below are from the last settings that worked. Reset to return to the defaults.";
    error.hidden = false;
    document.getElementById("reset").disabled = false;
  }
  writeAddressSoon();
}

function showCountry(key) {
  page.country = key;
  page.zoom = null;
  document.getElementById("zoom-reset").hidden = true;
  document.querySelectorAll("#country-tabs button").forEach(function (button) {
    button.setAttribute("aria-pressed", button.dataset.country === key ? "true" : "false");
  });
  document.title = page.data[key].name + " | Sovereign Debt Simulator | Isaac Slavens";
  buildControls();
  update();
}

function getJson(path) {
  return fetch(path).then(function (response) {
    if (!response.ok) throw new Error("Could not load " + path);
    return response.json();
  });
}

function startPage() {
  Promise.all([
    getJson("data/presets.json"), getJson("data/meta.json"), getJson("data/estimates.json")
  ]).then(function (files) {
    page.presets = files[0];
    page.meta = files[1];
    page.estimates = files[2];
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
        var flag = document.createElement("img");
        flag.src = "img/flag-" + c.key + ".png";
        flag.alt = "";
        button.append(flag, c.name);
        button.addEventListener("click", function () { showCountry(c.key); });
      } else {
        button.textContent = c.name + " (unavailable)";
        button.disabled = true;
      }
      tabs.append(button);
    });

    // The first country in the list that has data is shown first.
    var first = COUNTRIES.filter(function (c) { return page.data[c.key]; })[0];
    if (!first) throw new Error("No country data is available");
    page.country = first.key;
    readAddress();
    showCountry(page.country);

    // Copies the page address, which holds every setting.
    var copy = document.getElementById("copy-link");
    if (navigator.clipboard) {
      copy.hidden = false;
      copy.addEventListener("click", function () {
        clearTimeout(addressTimer);
        writeAddress();
        navigator.clipboard.writeText(location.href).then(function () {
          copy.textContent = "Link copied";
        }, function () {
          copy.textContent = "Could not copy";
        }).then(function () {
          setTimeout(function () { copy.textContent = "Copy link to this scenario"; }, 1600);
        });
      });
    }

    // An open explanation closes on Escape or a click anywhere else.
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeTips();
    });
    document.addEventListener("click", function (event) {
      if (!event.target.closest(".info, .tip")) closeTips();
    });
    // The question mark beside the warning shows or hides its explanation.
    document.getElementById("warning-why").addEventListener("click", function () {
      var more = document.getElementById("warning-more");
      more.hidden = !more.hidden;
      this.setAttribute("aria-expanded", String(!more.hidden));
    });
    document.getElementById("reset").addEventListener("click", function () {
      page.controls[page.country] = defaultControls(page.data[page.country]);
      buildControls();
      update();
    });

    document.getElementById("zoom-reset").addEventListener("click", function () { zoomTo(null, null); });

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
    var message = document.getElementById("error");
    message.textContent = "The simulator could not start: " + error.message;
    message.hidden = false;
  });
}

startPage();
