// Sovereign debt simulator: drawing charts with uPlot.
//
// drawChart(container, chart) draws one chart and returns the uPlot object.
// Call its destroy() before drawing another in the same container.
//
// chart:
//   years       the x values, one per year
//   startIndex  the position of the starting year in `years`. Everything up
//               to it is history (solid line); everything from it on is
//               projection (dashed line).
//   series      a list of { label, values, color, axis, decimals, unit }
//               values are already in display units, with null where there
//               is no data. color is 1 to 4. axis is "right" or "left".
//   stacked     true to stack the series as filled areas
//   zones       a list of { year, type }, type "stress" or "dominance"
//   xMin, xMax  the first and last year shown
//   endLabels   true to write each line's name and last value at its end,
//               so the lines can be told apart without their colors
//   rightLabel, leftLabel   axis titles

function drawChart(container, chart) {
  var css = getComputedStyle(document.documentElement);
  function color(name) {
    return css.getPropertyValue(name).trim();
  }

  var start = chart.startIndex;
  var hasLeft = chart.series.some(function (s) { return s.axis === "left"; });

  // What is plotted. When stacked, each series is drawn at the running
  // total of itself and the series before it.
  var plotted = chart.series.map(function (s) { return s.values.slice(); });
  if (chart.stacked) {
    for (var n = 1; n < plotted.length; n++) {
      plotted[n] = plotted[n].map(function (v, i) {
        return v === null || plotted[n - 1][i] === null ? null : v + plotted[n - 1][i];
      });
    }
  }

  // Each line becomes two uPlot series: history, then projection. Both
  // include the starting year, so the two parts join up.
  var data = [chart.years];
  var uSeries = [{ label: "Year" }];
  var order = chart.series.map(function (_, n) { return n; });
  if (chart.stacked) order.reverse(); // draw the tallest area first

  order.forEach(function (n) {
    var s = chart.series[n];
    var stroke = color("--line-" + s.color);
    var scale = s.axis === "left" ? "left" : "right";
    var history = plotted[n].map(function (v, i) { return i <= start ? v : null; });
    var projection = plotted[n].map(function (v, i) { return i >= start ? v : null; });

    // The legend shows the real value for the year under the pointer,
    // whichever part of the line it is on.
    function legendValue(u, raw, seriesIndex, i) {
      if (i === null || i === undefined) return "";
      var v = s.values[i];
      return v === null ? "no data" : v.toFixed(s.decimals) + (s.unit || "");
    }

    var common = {
      scale: scale,
      stroke: stroke,
      width: 2,
      points: { show: false },
      fill: chart.stacked ? stroke : undefined
    };
    data.push(history);
    uSeries.push(Object.assign({}, common, { label: s.label, class: "legend-hidden" }));
    data.push(projection);
    uSeries.push(Object.assign({}, common, {
      label: s.label,
      dash: chart.stacked ? undefined : [10, 6],
      value: legendValue
    }));
  });

  function percentOrNumber(decimals, unit) {
    return function (u, ticks) {
      return ticks.map(function (v) { return v.toFixed(decimals) + unit; });
    };
  }

  var axes = [
    {
      stroke: color("--muted"),
      grid: { stroke: color("--grid"), width: 1 },
      ticks: { stroke: color("--grid"), width: 1 },
      incrs: [1, 2, 5, 10, 20],
      values: function (u, ticks) { return ticks.map(String); } // years without a comma
    },
    {
      scale: "right",
      side: 1, // the value axis sits on the right
      stroke: color("--muted"),
      grid: { stroke: color("--grid"), width: 1 },
      ticks: { stroke: color("--grid"), width: 1 },
      size: 70,
      label: chart.rightLabel,
      labelSize: 18,
      values: percentOrNumber(chart.rightDecimals || 0, chart.rightUnit || "")
    }
  ];
  if (hasLeft) {
    axes.push({
      scale: "left",
      side: 3,
      stroke: color("--muted"),
      grid: { show: false },
      ticks: { stroke: color("--grid"), width: 1 },
      size: 64,
      label: chart.leftLabel,
      labelSize: 18,
      values: percentOrNumber(chart.leftDecimals || 0, chart.leftUnit || "")
    });
  }

  // Shaded bands for the two zones, one year wide each.
  function drawZones(u) {
    var ctx = u.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
    ctx.clip();
    chart.zones.forEach(function (zone) {
      var x0 = u.valToPos(zone.year - 0.5, "x", true);
      var x1 = u.valToPos(zone.year + 0.5, "x", true);
      ctx.fillStyle = color(zone.type === "dominance" ? "--dominance" : "--stress");
      ctx.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height);
    });
    ctx.restore();
  }

  // A stacked chart cannot show a dashed projection, so the projection is
  // veiled with the background color instead.
  function drawProjectionVeil(u) {
    var ctx = u.ctx;
    var x0 = u.valToPos(chart.years[start], "x", true);
    var right = u.bbox.left + u.bbox.width;
    if (x0 >= right) return;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = color("--bg");
    ctx.fillRect(Math.max(x0, u.bbox.left), u.bbox.top, right - Math.max(x0, u.bbox.left), u.bbox.height);
    ctx.restore();
  }

  // A tag on the right axis with the last value of the first series.
  function drawLastValueTag(u) {
    if (chart.stacked) return;
    var s = chart.series[0];
    var last = null;
    for (var i = 0; i < chart.years.length; i++) {
      if (chart.years[i] <= chart.xMax && s.values[i] !== null) last = s.values[i];
    }
    if (last === null) return;
    var ctx = u.ctx;
    var ratio = devicePixelRatio || 1;
    var text = last.toFixed(s.decimals) + (s.unit || "");
    var y = u.valToPos(last, s.axis === "left" ? "left" : "right", true);
    var x = u.bbox.left + u.bbox.width + 2 * ratio;
    ctx.save();
    ctx.font = "600 " + 12 * ratio + "px system-ui, sans-serif";
    var width = ctx.measureText(text).width + 10 * ratio;
    ctx.fillStyle = color("--line-" + s.color);
    ctx.fillRect(x, y - 9 * ratio, width, 18 * ratio);
    ctx.fillStyle = color("--bg");
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(text, x + 5 * ratio, y);
    ctx.restore();
  }

  // Each line's name and last value, written at the line's end.
  function drawEndLabels(u) {
    var ctx = u.ctx;
    var ratio = devicePixelRatio || 1;
    var labels = [];
    chart.series.forEach(function (s) {
      var last = null;
      var lastYear = null;
      for (var i = 0; i < chart.years.length; i++) {
        if (chart.years[i] <= chart.xMax && s.values[i] !== null) {
          last = s.values[i];
          lastYear = chart.years[i];
        }
      }
      if (last === null) return;
      labels.push({
        text: s.label + " " + last.toFixed(s.decimals) + (s.unit || ""),
        color: color("--line-" + s.color),
        x: u.valToPos(lastYear, "x", true),
        y: u.valToPos(last, "right", true) - 9 * ratio
      });
    });
    // Labels that would overlap are moved apart, keeping their order.
    labels.sort(function (a, b) { return a.y - b.y; });
    var gap = 15 * ratio;
    for (var n = 1; n < labels.length; n++) {
      if (labels[n].y - labels[n - 1].y < gap) labels[n].y = labels[n - 1].y + gap;
    }
    var bottom = u.bbox.top + u.bbox.height - 6 * ratio;
    var overflow = labels.length ? labels[labels.length - 1].y - bottom : 0;
    ctx.save();
    ctx.font = "600 " + 12 * ratio + "px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    labels.forEach(function (label) {
      var y = Math.max(u.bbox.top + 8 * ratio, label.y - Math.max(0, overflow));
      ctx.lineWidth = 4 * ratio;
      ctx.strokeStyle = color("--bg"); // a halo so the text stays readable over lines
      ctx.strokeText(label.text, label.x - 6 * ratio, y);
      ctx.fillStyle = label.color;
      ctx.fillText(label.text, label.x - 6 * ratio, y);
    });
    ctx.restore();
  }

  var options = {
    width: container.clientWidth,
    height: Math.max(300, Math.min(520, Math.round(window.innerHeight * 0.55))),
    scales: {
      x: { time: false, range: [chart.xMin, chart.xMax] },
      right: { range: chart.stacked ? [0, 100] : undefined },
      left: {}
    },
    series: uSeries,
    axes: axes,
    cursor: { x: true, y: true, points: { show: !chart.stacked } }, // the crosshair
    legend: { show: true, live: true },
    hooks: {
      drawClear: [function (u) { if (!chart.stacked) drawZones(u); }],
      draw: [function (u) {
        if (chart.stacked) {
          drawProjectionVeil(u);
          drawZones(u);
        }
        if (chart.endLabels) drawEndLabels(u);
        else drawLastValueTag(u);
      }]
    }
  };

  return new uPlot(options, data, container);
}
