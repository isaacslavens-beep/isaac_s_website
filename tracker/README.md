# Sovereign Debt Simulator

A scenario tool at [isaacslavens.com/tracker](https://isaacslavens.com/tracker/). It projects government
debt, the 10-year yield and the loss of a currency's purchasing power 30 years ahead for the United
States, Japan and Canada, from adjustable assumptions. It is not a forecast.

## Files

| Path | What it does |
|---|---|
| `index.html`, `css/tracker.css` | The page. Plain HTML and CSS, no build step. |
| `js/model.js` | The model: one pure function, `runModel(start, controls)`. Its header lists every input. |
| `js/ui.js` | Loads the data, builds the controls, runs the model on every change, fills in the text. |
| `js/charts.js` | Draws the two charts with [uPlot](https://github.com/leeoniya/uPlot) (in `js/vendor/`). |
| `data/` | One file per country, plus `presets.json` (slider ranges and defaults, with the basis for each). |
| `pipeline/` | Python that fetches the source data and writes `data/`. Sources are documented in `sources.yml`. |
| `tests/` | Tests of the model against hand calculations on an invented country. |

## The model, each year

1. Inflation moves toward the rate that M2 growth implies: M2 growth, less real growth, less the
   trend rise in M2 against GDP.
2. The average interest rate on the debt: one part in `maturity` reprices at last year's 10-year yield.
3. Debt: `debt × (1 + average rate) / (1 + nominal growth) − primary balance`.
4. Fiscal stress: interest above a share of revenue, or the primary balance needed to hold debt
   steady above the best the country has sustained.
5. The 10-year yield: the starting yield, moved one for one with inflation, plus a few basis points
   per point of GDP of debt that price-sensitive holders must absorb.
6. A yield cap: above it the central bank buys debt, up to a limit. Its buying creates money, which
   feeds back into inflation and the yield.

## Running it

```
python3 -m http.server 8765        # from the repository folder, then open localhost:8765/tracker/
node --test tracker/tests/model.test.js
```

The data is rebuilt with `pipeline/fetch.py`, then `pipeline/build.py` (needs a FRED API key in
`pipeline/.env`). The United Kingdom's data file is built but not shown on the page: it has no M2 series.
