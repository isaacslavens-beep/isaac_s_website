"""Builds the data files in tracker/data/ from the cache and the manual files.

Run after fetch.py:

    tracker/pipeline/.venv/bin/python tracker/pipeline/build.py

Every number written to a data file is a share of GDP or a rate, stored as
a fraction, and names the entries in sources.yml it came from. The build
fails if validation fails, and nothing is written in that case.
"""

import datetime
import json
import os
import sys

import yaml

from parsers import us_fed_f32s, us_tic_history, us_tic_table5

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
MANUAL = os.path.join(HERE, "manual")
DATA = os.path.join(HERE, "..", "data")


def main():
    with open(os.path.join(HERE, "sources.yml")) as f:
        sources = yaml.safe_load(f)["sources"]
    with open(os.path.join(HERE, "series.yml")) as f:
        series_list = yaml.safe_load(f)["series"]

    country = build_united_states(sources)

    problems = validate(country, sources)
    if problems:
        print("BUILD FAILED: validation found problems in " + country["country"], file=sys.stderr)
        for problem in problems:
            print("  - " + problem, file=sys.stderr)
        sys.exit(1)

    os.makedirs(DATA, exist_ok=True)
    write_json(os.path.join(DATA, country["country"] + ".json"), country)
    write_json(os.path.join(DATA, "meta.json"), build_meta(series_list, sources, [country]))

    print(f"Wrote {country['country']}.json, starting year {country['start']['year']}.")
    if not country["available"]:
        print("The country is marked unavailable. Still missing:")
        for item in country["missing"]:
            print("  - " + item)
    to_confirm = [key for key, entry in sources.items() if "to confirm" in json.dumps(entry)]
    if to_confirm:
        print("Registry entries with a field still marked 'to confirm': " + ", ".join(to_confirm))


# ---------------------------------------------------------------- United States

def build_united_states(sources):
    """The United States on a federal fiscal year basis. Fiscal year 2026
    ended on September 30, 2026."""
    surplus = load("us_surplus")
    interest = load("us_interest")
    receipts = load("us_receipts")
    gdp_quarters = load("us_gdp")
    cpi_months = load("us_cpi")
    debt_months = dict(load("us_marketable_debt"))
    rate_months = dict(load("us_average_rate"))
    yield_months = dict(load("us_yield_10y"))
    fed_weeks = load("us_fed_treasuries")
    maturity = dict(load("us_maturity"))
    growth = dict(load("us_growth_baseline"))

    # The fiscal years, and the date each one ended, come from the budget
    # series: its dates are fiscal year ends.
    year_end = {int(date[:4]): date for date, _ in surplus}
    surplus = by_year(surplus)
    receipts = by_year(receipts)

    # Net interest, in millions of dollars. The FRED series is net interest
    # through fiscal year 2014 and gross interest after, so from 2015 the
    # Monthly Treasury Statement's net interest is used instead.
    interest = {year: value for year, value in by_year(interest).items() if year <= 2014}
    for year, value in by_year(load("us_net_interest")).items():
        if year >= 2015:
            interest[year] = value / 1e6   # dollars to millions

    gdp = {}       # billions of dollars
    cpi = {}       # average index level over the fiscal year
    for year, end in year_end.items():
        quarters = last_values(gdp_quarters, quarter_start(end), 4, step_months=3)
        if quarters:
            gdp[year] = sum(quarters) / 4
        # The October 2025 index was never published, so a fiscal year may
        # be averaged over eleven months instead of twelve.
        months = last_values(cpi_months, end[:8] + "01", 12, step_months=1, may_miss=1)
        if months:
            cpi[year] = sum(months) / len(months)

    # One value per fiscal year for each series. A year is left out of a
    # series when its inputs do not exist for that year.
    debt, central_bank, yields, average_rate = {}, {}, {}, {}
    inflation, revenue, primary_balance, interest_to_revenue = {}, {}, {}, {}
    for year, end in year_end.items():
        if year not in gdp:
            continue
        if end in debt_months:
            debt[year] = debt_months[end] / 1000 / gdp[year]            # millions to billions
        fed = last_on_or_before(fed_weeks, end, within_days=7)
        if fed is not None:
            central_bank[year] = fed / 1000 / gdp[year]
        month = end[:8] + "01"
        if month in yield_months:
            yields[year] = yield_months[month] / 100
        if end in rate_months:
            average_rate[year] = rate_months[end] / 100
        if year in cpi and year - 1 in cpi:
            inflation[year] = cpi[year] / cpi[year - 1] - 1
        if year in receipts:
            revenue[year] = receipts[year] / 1000 / gdp[year]
        if year in surplus and year in interest:
            primary_balance[year] = (surplus[year] + interest[year]) / 1000 / gdp[year]
            interest_to_revenue[year] = interest[year] / receipts[year]

    history = {
        "debt": (debt, ["us_treasury_mspd", "bea_gdp"]),
        "centralBank": (central_bank, ["fed_h41", "bea_gdp"]),
        "yield": (yields, ["fed_h15"]),
        "averageRate": (average_rate, ["us_treasury_average_rates"]),
        "inflation": (inflation, ["bls_cpi"]),
        "revenue": (revenue, ["omb_budget", "bea_gdp"]),
        "primaryBalance": (primary_balance, ["omb_budget", "us_treasury_mts", "bea_gdp"]),
        "interestToRevenue": (interest_to_revenue, ["omb_budget", "us_treasury_mts"]),
    }

    # The starting year is the latest fiscal year that every series covers.
    start_year = min(max(values) for values, _ in history.values())
    start_end = year_end[start_year]

    if start_end not in maturity:
        stop(f"us_maturity has no value for {start_end}")
    growth_years = [str(start_year + n) for n in range(1, 6)]
    for year in growth_years:
        if year not in growth:
            stop(f"us_growth_baseline has no projection for {year}")
    baseline_growth = sum(growth[year] for year in growth_years) / 5 / 100

    threshold, threshold_years = largest_five_year_average(primary_balance, start_year)

    start = {"year": start_year, "yearEnd": start_end}
    for name, (values, source) in history.items():
        if name != "interestToRevenue":
            start[name] = {"value": values[start_year], "source": source}
    start["maturity"] = {"value": maturity[start_end], "source": ["us_treasury_mspd"]}
    start["growth"] = {
        "value": baseline_growth,
        "source": ["imf_weo"],
        "note": "average of IMF projections for " + growth_years[0] + " to " + growth_years[-1],
    }
    start["stressThreshold"] = {
        "value": threshold,
        "source": ["omb_budget", "us_treasury_mts", "bea_gdp"],
        "note": f"largest five-year average primary balance, fiscal years {threshold_years[0]} to {threshold_years[1]}",
    }

    # Ownership comes from the files Isaac downloads by hand. If one is
    # missing, the country is marked unavailable.
    ownership = us_ownership(sources, start_year, gdp, debt, central_bank)
    missing = ownership["missing"]
    parameters = {}
    if not missing:
        start["holdings"] = ownership["start"]
        start["japanHoldings"] = ownership["japan"]
        parameters["priceSensitive"] = {"domesticPrivate": ownership["domesticShare"]}
        for group, values in ownership["history"].items():
            source = ["us_treasury_mspd", "fed_h41", "us_tic_mfh", "bea_gdp"] if group == "domesticPrivate" \
                else ["us_tic_mfh", "bea_gdp"]
            history[group] = (values, source)

    return {
        "country": "united-states",
        "name": "United States",
        "available": not missing,
        "missing": missing,
        "yearBasis": "Federal fiscal year, ending September 30 (June 30 before fiscal year 1977).",
        "governmentCovered": "Federal government only. State and local debt is not included.",
        "start": start,
        "parameters": parameters,
        "history": {
            name: {
                "source": source,
                "firstYear": first_unbroken_year(values, start_year),
                "values": [values[y] for y in range(first_unbroken_year(values, start_year), start_year + 1)],
            }
            for name, (values, source) in history.items()
        },
    }


def us_ownership(sources, start_year, gdp, debt, central_bank):
    """Holdings by group from the manual files, as shares of GDP.

    Foreign official and foreign private come from the Treasury's Major
    Foreign Holders tables. Domestic private is what is left: debt minus
    Federal Reserve holdings minus foreign holdings. The Federal Reserve's
    sector table gives the price-sensitive share of domestic holders.
    """
    folder = os.path.join(MANUAL, "united-states")
    names = [us_tic_table5.FILE, us_tic_history.FILE, us_fed_f32s.FILE, us_fed_f32s.DICTIONARY]
    missing = ["manual file united-states/" + name for name in names
               if not os.path.exists(os.path.join(folder, name))]
    if missing:
        return {"missing": missing}

    try:
        table5 = us_tic_table5.parse(os.path.join(folder, us_tic_table5.FILE))
        older = us_tic_history.parse(os.path.join(folder, us_tic_history.FILE))
        sectors = us_fed_f32s.parse(os.path.join(folder, us_fed_f32s.FILE),
                                    os.path.join(folder, us_fed_f32s.DICTIONARY))
    except ValueError as error:
        stop(str(error))

    # Foreign holdings for each fiscal year: September, from Table 5 if it
    # covers that month and from the historical table otherwise. For the
    # starting year, the latest month is used if September is not out yet.
    history = {"domesticPrivate": {}, "foreignOfficial": {}, "foreignPrivate": {}}
    as_of = {}
    rows = {}
    for year in sorted(debt):
        if year not in central_bank:
            continue
        month = f"{year}-09"
        if month in table5:
            rows[year], as_of[year] = table5[month], month
        elif year in older:
            rows[year], as_of[year] = older[year], month
        elif year == start_year:
            latest = max(table5)
            if not f"{year - 1}-09" < latest < month:
                stop(f"{us_tic_table5.FILE}: its latest month, {latest}, is not in fiscal year {year}")
            rows[year], as_of[year] = table5[latest], latest
        else:
            continue
        row = rows[year]
        official = row["official"] / gdp[year]            # billions of dollars over billions
        private = (row["total"] - row["official"]) / gdp[year]
        domestic = debt[year] - central_bank[year] - official - private
        if domestic <= 0:
            stop(f"united-states {year}: Federal Reserve and foreign holdings exceed the debt")
        history["foreignOfficial"][year] = official
        history["foreignPrivate"][year] = private
        history["domesticPrivate"][year] = domestic

    if start_year not in rows:
        stop(f"united-states: no foreign holdings for the starting year {start_year}")
    row = rows[start_year]
    month_note = f"foreign holdings as of {as_of[start_year]}"
    if as_of[start_year] != f"{start_year}-09":
        month_note += f", the latest month published (September {start_year} is not out yet)"

    start = {
        "domesticPrivate": {
            "value": history["domesticPrivate"][start_year],
            "source": ["us_treasury_mspd", "fed_h41", "us_tic_mfh", "bea_gdp"],
            "note": "debt minus Federal Reserve holdings minus foreign holdings; " + month_note,
        },
        "foreignOfficial": {
            "value": history["foreignOfficial"][start_year],
            "source": ["us_tic_mfh", "bea_gdp"],
            "note": month_note,
        },
        "foreignPrivate": {
            "value": history["foreignPrivate"][start_year],
            "source": ["us_tic_mfh", "bea_gdp"],
            "note": "all foreign holdings minus foreign official; " + month_note,
        },
    }

    official_share = row["official"] / row["total"]
    japan = {
        "value": row["japan"] / gdp[start_year],
        "source": ["us_tic_mfh", "bea_gdp"],
        "note": "Japan-resident holdings; " + month_note + ". The source does not split them into "
                "official and private, so a selloff is taken from the two foreign groups in "
                "proportion to their holdings.",
        "split": {"foreignOfficial": official_share, "foreignPrivate": 1 - official_share},
    }

    # The price-sensitive share of domestic holders, using the mapping of
    # sectors to groups recorded in sources.yml.
    totals = {}
    for line in sources["fed_z1"]["category_mapping"]["lines"]:
        code = line["code"]
        if code not in sectors["values"]:
            stop(f"{us_fed_f32s.FILE}: the series {code} in sources.yml is not in the file")
        if not sectors["descriptions"][code].startswith(line["sector"]):
            stop(f"{us_fed_f32s.FILE}: {code} is described as \"{sectors['descriptions'][code]}\", "
                 f"but sources.yml maps it as \"{line['sector']}\"")
        totals[line["group"]] = totals.get(line["group"], 0) + sectors["values"][code]

    # Every holder must be mapped exactly once: together with the table's
    # discrepancy line, the mapped sectors must add up to the total.
    marketable = sectors["values"]["FL313161105.Q"]
    if abs(sum(totals.values()) - marketable) > 0.001 * marketable:
        stop(f"{us_fed_f32s.FILE}: the mapped sectors add up to {sum(totals.values()):,.0f} but total "
             f"marketable Treasury securities are {marketable:,.0f}. A sector is missing from, or "
             "counted twice in, the mapping in sources.yml.")

    domestic_share = {
        "value": totals["price-sensitive"] / (totals["price-sensitive"] + totals["captive"]),
        "source": ["fed_z1"],
        "note": f"price-sensitive domestic sectors as a share of all domestic private sectors, {sectors['period']}",
    }

    return {"missing": [], "start": start, "japan": japan,
            "domesticShare": domestic_share, "history": history}


def largest_five_year_average(values, last_year):
    """The largest five-year average in the unbroken run of years ending at
    last_year. Returns the average and its first and last year."""
    first = first_unbroken_year(values, last_year)
    best, best_years = None, None
    for end in range(first + 4, last_year + 1):
        average = sum(values[y] for y in range(end - 4, end + 1)) / 5
        if best is None or average > best:
            best, best_years = average, (end - 4, end)
    if best is None:
        stop("fewer than five years of primary balance history")
    return best, best_years


# ---------------------------------------------------------------- validation

def validate(country, sources):
    """Returns a list of problems. An empty list means the file is valid."""
    problems = []
    start = country["start"]

    def check_value(label, value):
        if not isinstance(value, (int, float)) or value != value:
            problems.append(f"{label} is empty or not a number")
        elif abs(value) > 20:
            problems.append(f"{label} is {value}: ratios must be stored as fractions")

    def check_sources(label, keys):
        if not keys:
            problems.append(f"{label} names no source")
        for key in keys:
            if key not in sources:
                problems.append(f"{label} points to '{key}', which is not in sources.yml")

    items = {"start." + name: item for name, item in start.items() if isinstance(item, dict)}
    for name, item in start.get("holdings", {}).items():
        items["start.holdings." + name] = item
    for name, item in country["parameters"].get("priceSensitive", {}).items():
        items["parameters.priceSensitive." + name] = item
    items.pop("start.holdings", None)
    for label, item in items.items():
        check_sources(label, item.get("source"))
        if label != "start.maturity":
            check_value(label, item["value"])

    for name, series in country["history"].items():
        check_sources("history." + name, series.get("source"))
        expected = start["year"] - series["firstYear"] + 1
        if len(series["values"]) != expected:
            problems.append(f"history.{name} has {len(series['values'])} values for {expected} years")
        for offset, value in enumerate(series["values"]):
            check_value(f"history.{name} {series['firstYear'] + offset}", value)

    if not (start["maturity"]["value"] >= 1):
        problems.append("start.maturity must be at least 1 year")

    # The holder groups must sum to the debt within 1%.
    if country["available"]:
        holders = start["holdings"]
        total = start["centralBank"]["value"] + sum(group["value"] for group in holders.values())
        gap = total - start["debt"]["value"]
        if abs(gap) > 0.01 * start["debt"]["value"]:
            problems.append(
                f"holder groups sum to {total:.4f} of GDP but debt is {start['debt']['value']:.4f}: "
                f"a gap of {gap:+.4f}, more than 1% of the debt")

    # The fiscal series and the debt series must cover the same government.
    if not country.get("governmentCovered"):
        problems.append("the file does not state which government its fiscal and debt series cover")

    return problems


# ---------------------------------------------------------------- meta.json

def build_meta(series_list, sources, countries):
    """When each source was retrieved, and which countries are available."""
    retrieved = {}
    editions = {}
    for series in series_list:
        with open(os.path.join(CACHE, series["key"] + ".json")) as f:
            cached = json.load(f)
        source = series["source"]
        retrieved[source] = max(retrieved.get(source, ""), cached["retrieved"])
        if cached["service"] == "imf_datamapper":
            editions[source] = cached["metadata"]["source"]

    # Manual files: the download date is the last field of each line in
    # the country's notes.txt (file | address | table name | date).
    manual_files = {
        "us_tic_mfh": ("united-states", [us_tic_table5.FILE, us_tic_history.FILE]),
        "fed_z1": ("united-states", [us_fed_f32s.FILE]),
    }
    for source, (folder, names) in manual_files.items():
        notes = os.path.join(MANUAL, folder, "notes.txt")
        if not os.path.exists(notes):
            continue
        with open(notes) as f:
            for line in f:
                cells = [cell.strip() for cell in line.split("|")]
                if len(cells) == 4 and cells[0] in names:
                    retrieved[source] = max(retrieved.get(source, ""), cells[3])

    return {
        "lastSuccessfulRun": datetime.date.today().isoformat(),
        "countries": {
            country["country"]: {"name": country["name"], "available": country["available"]}
            for country in countries
        },
        "sources": {
            key: {
                "label": sources[key]["chart_label"],
                "retrievedOn": retrieved[key],
                **({"edition": editions[key]} if key in editions else {}),
            }
            for key in sorted(retrieved)
        },
    }


# ---------------------------------------------------------------- helpers

def load(key):
    """The observations of one cached series, as [date, value] pairs in
    date order."""
    path = os.path.join(CACHE, key + ".json")
    if not os.path.exists(path):
        stop(f"{key} is not in the cache. Run fetch.py first.")
    with open(path) as f:
        return json.load(f)["observations"]


def by_year(observations):
    return {int(date[:4]): value for date, value in observations}


def quarter_start(date):
    """The first day of the quarter a date falls in: 2026-09-30 gives
    2026-07-01."""
    month = (int(date[5:7]) - 1) // 3 * 3 + 1
    return f"{date[:4]}-{month:02d}-01"


def last_values(observations, last_date, count, step_months, may_miss=0):
    """The values of the `count` periods ending at last_date, or None if
    more than `may_miss` of them are missing."""
    values = dict(observations)
    year, month = int(last_date[:4]), int(last_date[5:7])
    found = []
    for _ in range(count):
        date = f"{year}-{month:02d}-01"
        if date in values:
            found.append(values[date])
        elif count - len(found) > 0 and may_miss > 0:
            may_miss -= 1
        else:
            return None
        month -= step_months
        if month < 1:
            month += 12
            year -= 1
    return found


def last_on_or_before(observations, date, within_days):
    """The latest value dated on or before `date`, if it is no more than
    `within_days` older."""
    limit = datetime.date.fromisoformat(date)
    found = None
    for observed, value in observations:
        day = datetime.date.fromisoformat(observed)
        if day <= limit and (limit - day).days <= within_days:
            found = value
    return found


def first_unbroken_year(values, last_year):
    """The first year of the run of years, without gaps, ending at last_year."""
    year = last_year
    while year - 1 in values:
        year -= 1
    return year


def write_json(path, content):
    with open(path, "w") as f:
        json.dump(content, f, indent=2)
        f.write("\n")


def stop(message):
    print("BUILD FAILED: " + message, file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
