// Sovereign debt simulator: drawing charts with uPlot.
//
// drawChart(container, chart) draws one chart and returns the uPlot object.
// Call its destroy() before drawing another in the same container.
//
// chart:
//   years        the x values, one per year
//   startIndex   the position of the starting year in `years`. Up to it is
//                history (solid line); from it on, projection (dashed line).
//   series       a list of { label, values, color, decimals, unit, width, dotted }:
//                values are in display units, with null where there is no
//                data; color is 1 or 2 (--line-1 or --line-2 in the CSS);
//                dotted draws the whole line dotted, with looser dots for
//                the projection
//   unit, decimals  for the value axis on the right
//   stressYears  the years to shade as fiscal stress
//   xMin, xMax   the first and last year shown
//   zoom         optional { min, max }: the years to show, when zoomed in
//   onZoom       optional: called with (min, max) when the reader drags
//                across the chart, or with nulls on a double-click
//   syncKey      optional: charts with the same key share one crosshair

function drawChart(container, chart) {
  var css = getComputedStyle(document.documentElement);
  function color(name) {
    return css.getPropertyValue(name).trim();
  }
  var start = chart.startIndex;

  // Each line becomes two uPlot series: history, then projection. Both
  // include the starting year, so the two parts join up.
  var data = [chart.years];
  var uSeries = [{
    label: "Year",
    value: function (u, year) { return year === null ? chart.years[chart.years.length - 1] : year; }
  }];
  chart.series.forEach(function (s) {
    var common = {
      scale: "y",
      stroke: color("--line-" + s.color),
      width: s.width || 2.25,
      points: { show: false },
      cap: s.dotted ? "round" : undefined
    };
    // History: listed nowhere, hidden and shown together with its projection.
    data.push(s.values.map(function (v, i) { return i <= start ? v : null; }));
    uSeries.push(Object.assign({}, common, {
      label: s.label,
      class: "legend-hidden",
      dash: s.dotted ? [1, 4] : undefined
    }));
    // Projection: its legend entry shows the value for the year under the
    // pointer, history or projection, or the last year with no pointer.
    data.push(s.values.map(function (v, i) { return i >= start ? v : null; }));
    uSeries.push(Object.assign({}, common, {
      label: s.label,
      class: s.dotted ? "legend-dotted" : undefined,
      dash: s.dotted ? [1, 7] : [10, 6],
      value: function (u, raw, seriesIndex, i) {
        var v = s.values[i === null || i === undefined ? chart.years.length - 1 : i];
        return v === null ? "no data" : v.toFixed(s.decimals) + s.unit;
      }
    }));
  });

  var font = "11px " + color("--mono");
  var axis = {
    font: font,
    stroke: color("--muted"),
    grid: { stroke: color("--grid"), width: 1 },
    ticks: { stroke: color("--grid"), width: 1 }
  };
  var axes = [
    Object.assign({}, axis, {
      incrs: [1, 2, 5, 10, 20],
      values: function (u, ticks) { return ticks.map(String); }   // years without a comma
    }),
    Object.assign({}, axis, {
      scale: "y",
      side: 1,   // on the right
      size: 58,
      values: function (u, ticks) {
        return ticks.map(function (v) { return v.toFixed(chart.decimals) + chart.unit; });
      }
    })
  ];

  // Fiscal stress: a shaded band one year wide for each year in stress.
  function drawStress(u) {
    var ctx = u.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
    ctx.clip();
    ctx.fillStyle = color("--stress");
    chart.stressYears.forEach(function (year) {
      var x0 = u.valToPos(year - 0.5, "x", true);
      var x1 = u.valToPos(year + 0.5, "x", true);
      ctx.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height);
    });
    ctx.restore();
  }

  // A thin dashed vertical line at the starting year, where history ends
  // and the projection begins.
  function drawStartLine(u) {
    var ctx = u.ctx;
    var ratio = devicePixelRatio || 1;
    var x = Math.round(u.valToPos(chart.years[start], "x", true));
    if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) return;
    ctx.save();
    ctx.strokeStyle = color("--muted");
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = ratio;
    ctx.setLineDash([3 * ratio, 3 * ratio]);
    ctx.beginPath();
    ctx.moveTo(x, u.bbox.top);
    ctx.lineTo(x, u.bbox.top + u.bbox.height);
    ctx.stroke();
    ctx.restore();
  }

  // A tag on the axis with the first line's last value in view.
  function drawLastValueTag(u) {
    if (!u.series[2].show) return;   // the first line is hidden
    var lastYear = Math.min(chart.xMax, u.scales.x.max);
    var s = chart.series[0];
    var last = null;
    for (var i = 0; i < chart.years.length; i++) {
      if (chart.years[i] <= lastYear && s.values[i] !== null) last = s.values[i];
    }
    if (last === null) return;
    var ctx = u.ctx;
    var ratio = devicePixelRatio || 1;
    var text = last.toFixed(s.decimals) + s.unit;
    var y = u.valToPos(last, "y", true);
    var x = u.bbox.left + u.bbox.width + 2 * ratio;
    ctx.save();
    ctx.font = "600 " + 11 * ratio + "px " + color("--mono");
    var width = ctx.measureText(text).width + 10 * ratio;
    ctx.fillStyle = color("--line-" + s.color);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y - 9 * ratio, width, 18 * ratio, 3 * ratio);
    else ctx.rect(x, y - 9 * ratio, width, 18 * ratio);   // older browsers: square corners
    ctx.fill();
    ctx.fillStyle = color("--bg");
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(text, x + 5 * ratio, y);
    ctx.restore();
  }

  // While the chart is being built, its first scale does not count as a
  // zoom by the reader.
  var building = true;

  var plot = new uPlot({
    width: container.clientWidth,
    height: Math.max(320, Math.min(540, Math.round(window.innerHeight * 0.56))),
    scales: {
      // The years shown are always set here: the whole period, or a zoom.
      x: {
        time: false,
        auto: false,
        range: function (u, min, max) {
          return min === null || min === undefined ? [chart.xMin, chart.xMax] : [min, max];
        }
      },
      y: {}
    },
    series: uSeries,
    axes: axes,
    cursor: {
      x: true, y: true, points: { show: true },   // the crosshair
      sync: chart.syncKey ? { key: chart.syncKey } : undefined,
      drag: { x: true, y: false, setScale: true },  // drag across to zoom
      bind: { dblclick: function () { return function () { return null; }; } }   // handled below
    },
    legend: { show: true, live: true },
    hooks: {
      // The whole period is reported as no zoom.
      setScale: [function (u, key) {
        if (key !== "x" || building || !chart.onZoom) return;
        var min = u.scales.x.min;
        var max = u.scales.x.max;
        if (min <= chart.xMin && max >= chart.xMax) chart.onZoom(null, null);
        else chart.onZoom(min, max);
      }],
      // Clicking a line's legend entry hides its history too: the
      // projection is the listed series, its history the one before it.
      setSeries: [function (u, i, opts) {
        if (!opts || opts.show === undefined || i === 0 || i % 2 !== 0) return;
        if (u.series[i - 1].show !== opts.show) u.setSeries(i - 1, { show: opts.show });
      }],
      drawClear: [function (u) {
        drawStress(u);
        drawStartLine(u);
      }],
      draw: [drawLastValueTag]
    }
  }, data, container);

  var view = chart.zoom || { min: chart.xMin, max: chart.xMax };
  plot.setScale("x", { min: view.min, max: view.max });
  // uPlot applies scales a moment later, so zooms count from then on.
  setTimeout(function () { building = false; }, 0);

  // A double-click shows the whole period again.
  plot.over.addEventListener("dblclick", function () {
    if (chart.onZoom) chart.onZoom(null, null);
  });
  return plot;
}
