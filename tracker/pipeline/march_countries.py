"""The United Kingdom, Japan and Canada.

All three are on a fiscal year from April 1 to March 31, named by the
calendar year it ends in: "2026" is the year to March 31, 2026. Their
debt, ownership and budget figures come from the files in manual/. Their
GDP, yield, consumer prices and growth projections are fetched.

Each country's function reads its manual files, puts every amount in the
units of that country's GDP series, and hands the result to assemble(),
which is the same for all three.
"""

import os

from helpers import (MANUAL, baseline_balance, baseline_growth, baseline_inflation, first_unbroken_year, largest_five_year_average, last_values, load, stop)
from parsers import (ca_boc_debt, ca_statcan_gfs, ca_statcan_holdings, jp_boj_fof, jp_mof_debt,
                     jp_mof_general_bonds, jp_mof_maturity, jp_mof_table4, jp_mof_table20,
                     uk_dmo_gilt_holdings, uk_dmo_portfolio, uk_ons_psa6, uk_ons_tbill_holdings)

YEAR_BASIS = ("Fiscal year from April 1 to March 31, named by the year it ends in: "
              "2026 is the year to March 31, 2026.")
ONE_FOREIGN_GROUP = ("Foreign holders are one group: the data does not separate foreign official "
                     "from foreign private holders.")
GROUPS = ("central bank", "captive", "price-sensitive", "foreign")

# Which manual files each source in sources.yml comes from. build.py reads
# their download dates from the country's notes.txt.
MANUAL_SOURCES = {
    "dmo_gilt_holdings": ("united-kingdom", [uk_dmo_gilt_holdings.FILE]),
    "ons_ukea_tbills": ("united-kingdom", [uk_ons_tbill_holdings.FILE]),
    "dmo_debt_portfolio": ("united-kingdom", [uk_dmo_portfolio.FILE]),
    "ons_psf": ("united-kingdom", [uk_ons_psa6.FILE]),
    "boj_fof": ("japan", [jp_boj_fof.FILE]),
    "mof_debt": ("japan", [jp_mof_debt.FILE]),
    "mof_dmr": ("japan", [jp_mof_maturity.FILE, jp_mof_general_bonds.FILE]),
    "mof_general_account": ("japan", [jp_mof_table4.FILE, jp_mof_table20.FILE]),
    "statcan_nbsa": ("canada", [ca_statcan_holdings.FILE]),
    "statcan_gfs": ("canada", [ca_statcan_gfs.FILE]),
    "boc_debt": ("canada", [ca_boc_debt.FILE]),
}


def build_all(sources):
    return [build_japan(sources), build_united_kingdom(sources), build_canada(sources)]


# ---------------------------------------------------------------- United Kingdom

def build_united_kingdom(sources):
    country = {"country": "united-kingdom", "name": "United Kingdom"}
    files = read_manual(country, {
        "gilts": uk_dmo_gilt_holdings,
        "bills": uk_ons_tbill_holdings,
        "portfolio": uk_dmo_portfolio,
        "accounts": uk_ons_psa6,
    })
    if files is None:
        return country
    gilts, bills, portfolio, accounts = (files[name] for name in ("gilts", "bills", "portfolio", "accounts"))

    # GDP is in millions of pounds, so everything else is put in millions.
    debt = {year: row["debt"] * 1000 for year, row in portfolio.items()}       # billions to millions
    maturity = {year: row["maturity"] for year, row in portfolio.items()}

    holders = {}
    for year in sorted(set(gilts) & set(bills)):
        gilt_groups = group_totals(gilts[year], sources, "dmo_gilt_holdings", uk_dmo_gilt_holdings.TOTAL, year)
        bill_groups = group_totals(bills[year], sources, "ons_ukea_tbills", uk_ons_tbill_holdings.TOTAL, year)
        holders[year] = {group: gilt_groups[group] + bill_groups[group] for group in GROUPS}

    revenue = {year: row["receipts"] for year, row in accounts.items()}
    interest = {year: row["interest"] for year, row in accounts.items()}
    primary = {year: row["interest"] - row["net_borrowing"] for year, row in accounts.items()}

    return assemble(country, sources, {
        "prefix": "uk",
        "gdp_rule": "sum",
        "gdp_source": "ons_gdp",
        "government": "Central government only. Local government debt is not included.",
        "notes": [
            ONE_FOREIGN_GROUP,
            "Each group's share of the debt is measured at market value and applied to the debt at nominal value.",
        ],
        "debt": debt, "debt_source": ["dmo_debt_portfolio"],
        "holders": holders, "holders_source": ["dmo_gilt_holdings", "ons_ukea_tbills"],
        "revenue": revenue, "interest": interest, "primary": primary, "fiscal_source": ["ons_psf"],
        "average_rate": interest_over_average_debt(interest, debt),
        "rate_source": ["ons_psf", "dmo_debt_portfolio"],
        "rate_note": "interest paid in the year divided by the average of the debt at its start and end",
        "maturity": maturity, "maturity_source": ["dmo_debt_portfolio"],
    })


# ---------------------------------------------------------------- Japan

def build_japan(sources):
    country = {"country": "japan", "name": "Japan"}
    files = read_manual(country, {
        "holders": jp_boj_fof,
        "debt": jp_mof_debt,
        "maturity": jp_mof_maturity,
        "bonds": jp_mof_general_bonds,
        "revenue": jp_mof_table4,
        "spending": jp_mof_table20,
    })
    if files is None:
        return country

    # GDP is in billions of yen, so everything else is put in billions.
    debt = {year: (row["general"] + row["filp"] + row["bills"]) / 10          # 100 million yen to billions
            for year, row in files["debt"].items()}

    holders = {year: group_totals(sectors, sources, "boj_fof", jp_boj_fof.TOTAL, year)
               for year, sectors in files["holders"].items() if year in debt}

    # The primary balance on the Ministry of Finance's definition: revenue
    # other than bond issues, minus spending other than debt service. The
    # surplus carried over from the year before is not counted as revenue.
    revenue, primary = {}, {}
    for year in sorted(set(files["revenue"]) & set(files["spending"])):
        received, spent = files["revenue"][year], files["spending"][year]
        revenue[year] = (received["total"] - received["bonds"] - received["carried"]) / 1000   # millions to billions
        primary[year] = revenue[year] - (spent["total"] - spent["debt_service"]) / 1e6         # thousands to billions

    interest = {year: row["interest"] * 1000 for year, row in files["bonds"].items()}          # trillions to billions
    average_rate = {year: row["rate"] / 100 for year, row in files["bonds"].items()}

    return assemble(country, sources, {
        "prefix": "jp",
        "growth_from_imf": True,
        "gdp_rule": "average",
        "gdp_source": "cao_gdp",
        "government": ("Central government only: government bonds, including Fiscal Investment and Loan "
                       "Program bonds, and financing bills. Local government debt is not included."),
        "notes": [
            ONE_FOREIGN_GROUP,
            "Each group's share of the debt is measured at market value and applied to the debt at face value.",
            "The primary balance is the general account's, on the Ministry of Finance's definition: "
            "revenue other than bond issues, minus spending other than debt service.",
        ],
        "debt": debt, "debt_source": ["mof_debt"],
        "holders": holders, "holders_source": ["boj_fof"],
        "revenue": revenue, "interest": interest, "primary": primary, "fiscal_source": ["mof_general_account"],
        "interest_source": ["mof_dmr"],
        "average_rate": average_rate, "rate_source": ["mof_dmr"],
        "rate_note": "weighted average interest rate on general bonds outstanding",
        "maturity": files["maturity"], "maturity_source": ["mof_dmr"],
    })


# ---------------------------------------------------------------- Canada

def build_canada(sources):
    country = {"country": "canada", "name": "Canada"}
    files = read_manual(country, {
        "holdings": ca_statcan_holdings,
        "accounts": ca_statcan_gfs,
        "term": ca_boc_debt,
    })
    if files is None:
        return country
    holdings, accounts, term = files["holdings"], files["accounts"], files["term"]

    # GDP is in millions of dollars, and so is everything else.
    debt = {year: sum(owed.values()) for year, owed in holdings["owed"].items()}

    holders = {}
    for year, items in holdings["holders"].items():
        totals = dict.fromkeys(GROUPS, 0.0)
        for item, sectors in items.items():
            groups = group_totals(sectors, sources, "statcan_nbsa", "Total all sectors", year)
            for group in GROUPS:
                totals[group] += groups[group]
        holders[year] = totals

    revenue, interest, primary = {}, {}, {}
    for year, row in accounts.items():
        federal, provincial = row["federal"], row["provincial"]
        revenue[year] = federal["revenue"] + provincial["revenue"]
        interest[year] = federal["interest"] + provincial["interest"]
        primary[year] = federal["net_lending"] + provincial["net_lending"] + interest[year]

    return assemble(country, sources, {
        "prefix": "ca",
        "gdp_rule": "sum",
        "gdp_source": "imf_ifs_gdp",
        "government": ("The federal government and the provincial and territorial governments, "
                       "treated as one borrower. Local government debt is not included."),
        "notes": [
            ONE_FOREIGN_GROUP,
            "The yield and the average maturity are the federal government's, used for provincial debt "
            "as well: no current provincial series is published.",
            "Each group's share of the debt is measured at market value and applied to the debt at book value. "
            "The holders of provincial short-term paper are not published, so it is spread over the groups "
            "in the same proportions as the rest.",
            "Revenue adds federal and provincial revenue, so federal transfers to provinces are counted twice.",
        ],
        "debt": debt, "debt_source": ["statcan_nbsa"],
        "holders": holders, "holders_source": ["statcan_nbsa"],
        "revenue": revenue, "interest": interest, "primary": primary, "fiscal_source": ["statcan_gfs"],
        "average_rate": interest_over_average_debt(interest, debt),
        "rate_source": ["statcan_gfs", "statcan_nbsa"],
        "rate_note": "interest expense in the year divided by the average of the debt at its start and end",
        "maturity": term, "maturity_source": ["boc_debt"],
        "maturity_note": "federal government securities only",
    })


# ---------------------------------------------------------------- shared

def read_manual(country, parsers):
    """Parses the country's manual files. If any file is missing, marks
    the country unavailable and returns None."""
    folder = os.path.join(MANUAL, country["country"])
    missing = [f"manual file {country['country']}/{parser.FILE}" for parser in parsers.values()
               if not os.path.exists(os.path.join(folder, parser.FILE))]
    if missing:
        country["available"] = False
        country["missing"] = missing
        return None
    try:
        return {name: parser.parse(os.path.join(folder, parser.FILE)) for name, parser in parsers.items()}
    except ValueError as error:
        stop(str(error))


def group_totals(sectors, sources, source_key, total_name, year):
    """Adds up one year's holdings into the four groups, using the mapping
    of sectors to groups recorded in sources.yml. Every holder must be
    mapped exactly once, so the groups must add up to the table's total."""
    totals = dict.fromkeys(GROUPS, 0.0)
    for line in sources[source_key]["category_mapping"]["lines"]:
        if line["group"] not in GROUPS:
            stop(f"sources.yml, {source_key}: '{line['group']}' is not one of {', '.join(GROUPS)}")
        # A sector the table has no figure for in this year counts as zero.
        # If that leaves a real holder out, the total below will not match.
        totals[line["group"]] += sectors.get(str(line["sector"]), 0.0)
    total = sectors[total_name]
    if abs(sum(totals.values()) - total) > 0.002 * total:
        stop(f"{source_key}, {year}: the mapped sectors add up to {sum(totals.values()):,.0f} but the total "
             f"is {total:,.0f}. A sector is missing from, or counted twice in, the mapping in sources.yml.")
    return totals


def interest_over_average_debt(interest, debt):
    return {year: interest[year] / ((debt[year - 1] + debt[year]) / 2)
            for year in interest if year in debt and year - 1 in debt}


def assemble(country, sources, given):
    """Turns one country's amounts into the data file. Every amount in
    `given` is in the units of the country's GDP series."""
    prefix = given["prefix"]
    gdp_quarters = load(prefix + "_gdp")
    cpi_months = load(prefix + "_cpi")
    yield_months = dict(load(prefix + "_yield_10y"))
    growth = dict(load(prefix + "_growth_baseline"))

    last_year = int(gdp_quarters[-1][0][:4]) + 1
    gdp, cpi = {}, {}
    for year in range(1900, last_year + 1):
        quarters = last_values(gdp_quarters, f"{year}-01-01", 4, step_months=3)
        if quarters:
            gdp[year] = sum(quarters) if given["gdp_rule"] == "sum" else sum(quarters) / 4
        months = last_values(cpi_months, f"{year}-03-01", 12, step_months=1)
        if months:
            cpi[year] = sum(months) / 12

    def share_of_gdp(amounts):
        return {year: amount / gdp[year] for year, amount in amounts.items() if year in gdp}

    debt = share_of_gdp(given["debt"])
    yields = {int(date[:4]): value / 100 for date, value in yield_months.items() if date[5:7] == "03"}
    inflation = {year: cpi[year] / cpi[year - 1] - 1 for year in cpi if year - 1 in cpi}
    revenue = share_of_gdp(given["revenue"])
    primary_balance = share_of_gdp(given["primary"])
    interest_to_revenue = {year: given["interest"][year] / given["revenue"][year]
                           for year in given["interest"] if year in given["revenue"]}
    average_rate = dict(given["average_rate"])

    # Each group's share of all holdings, applied to the debt.
    central_bank, domestic, foreign, sensitive_share = {}, {}, {}, {}
    for year, groups in given["holders"].items():
        if year not in debt:
            continue
        total = sum(groups.values())
        central_bank[year] = groups["central bank"] / total * debt[year]
        domestic[year] = (groups["captive"] + groups["price-sensitive"]) / total * debt[year]
        foreign[year] = groups["foreign"] / total * debt[year]
        sensitive_share[year] = groups["price-sensitive"] / (groups["captive"] + groups["price-sensitive"])

    gdp_source = given["gdp_source"]
    fiscal = given["fiscal_source"] + [gdp_source]
    history = {
        "debt": (debt, given["debt_source"] + [gdp_source]),
        "centralBank": (central_bank, given["holders_source"] + given["debt_source"] + [gdp_source]),
        "domestic": (domestic, given["holders_source"] + given["debt_source"] + [gdp_source]),
        "foreign": (foreign, given["holders_source"] + given["debt_source"] + [gdp_source]),
        "yield": (yields, ["oecd_yields"]),
        "inflation": (inflation, ["bis_cpi"]),
        "averageRate": (average_rate, given["rate_source"]),
        "revenue": (revenue, fiscal),
        "primaryBalance": (primary_balance, fiscal),
        "interestToRevenue": (interest_to_revenue, given.get("interest_source", []) + given["fiscal_source"]),
    }
    budget_series = ("averageRate", "revenue", "primaryBalance", "interestToRevenue")

    # The starting year is the latest year covered by the debt, its
    # holders, the yield, inflation and the average maturity.
    start_year = min(max(values) for name, (values, _) in history.items() if name not in budget_series)
    start_year = min(start_year, max(given["maturity"]))

    # The largest five-year average primary balance, and the average
    # primary balance, from actual years only.
    last_budget_year = min(start_year, max(primary_balance))
    threshold, threshold_years = largest_five_year_average(primary_balance, last_budget_year)
    average_balance = baseline_balance(primary_balance, last_budget_year, fiscal)

    # Real GDP by fiscal year, for average growth. Japan has no quarterly
    # real GDP series among those fetched, so the IMF's yearly growth
    # rates are used for Japan instead.
    if given.get("growth_from_imf"):
        level, real_gdp = 1.0, {}
        for year in sorted(growth):
            if int(year) < start_year:            # later years are projections
                level *= 1 + growth[year] / 100
                real_gdp[int(year)] = level
        real_gdp[min(real_gdp) - 1] = 1.0
        average_growth = baseline_growth(real_gdp, start_year - 1, ["imf_weo"])
        average_growth["note"] += ". Calendar years"
    else:
        real_quarters = load(prefix + "_real_gdp")
        real_gdp = {}
        for year in range(1900, last_year + 1):
            quarters = last_values(real_quarters, f"{year}-01-01", 4, step_months=3)
            if quarters:
                real_gdp[year] = sum(quarters) / 4
        average_growth = baseline_growth(real_gdp, start_year, [gdp_source])

    # Budget figures are settled later than the rest. If one stops a year
    # short of the starting year, its latest value is carried into the
    # starting year, and the data file says so.
    carried = {}
    for name in budget_series:
        values = history[name][0]
        if max(values) >= start_year:
            continue
        if max(values) < start_year - 1:
            stop(f"{country['country']}: {name} ends in {max(values)}, more than a year before "
                 f"the starting year {start_year}")
        values[start_year] = values[start_year - 1]
        carried[name] = (f"the value for the year to March {start_year - 1}, the latest published, "
                         f"carried into {start_year}")

    growth_years = [str(start_year + n) for n in range(1, 6)]
    for year in growth_years:
        if year not in growth:
            stop(f"{prefix}_growth_baseline has no projection for {year}")

    def item(value, source, note=None):
        return {"value": value, "source": source, **({"note": note} if note else {})}

    start = {"year": start_year, "yearEnd": f"{start_year}-03-31"}
    for name in ("debt", "centralBank", "yield", "inflation", "revenue", "primaryBalance"):
        values, source = history[name]
        start[name] = item(values[start_year], source, carried.get(name))
    rate_note = given["rate_note"] + ("; " + carried["averageRate"] if "averageRate" in carried else "")
    start["averageRate"] = item(average_rate[start_year], given["rate_source"], rate_note)
    start["maturity"] = item(given["maturity"][start_year], given["maturity_source"], given.get("maturity_note"))
    start["baselineInflation"] = baseline_inflation(inflation, start_year, ["bis_cpi"])
    start["baselineGrowth"] = average_growth
    start["baselinePrimaryBalance"] = average_balance
    start["growth"] = item(sum(growth[year] for year in growth_years) / 5 / 100, ["imf_weo"],
                           "average of IMF projections for " + growth_years[0] + " to " + growth_years[-1])
    start["stressThreshold"] = item(
        threshold, fiscal,
        f"largest five-year average primary balance, years to March {threshold_years[0]} to {threshold_years[1]}")
    holders_source = given["holders_source"] + given["debt_source"] + [gdp_source]
    start["holdings"] = {
        "domestic": item(domestic[start_year], holders_source,
                         "every domestic holder other than the central bank, as a share of all holdings, "
                         "applied to the debt"),
        "foreign": item(foreign[start_year], holders_source,
                        "holders abroad, official and private together, as a share of all holdings, "
                        "applied to the debt"),
    }

    country.update({
        "available": True,
        "missing": [],
        "yearBasis": YEAR_BASIS,
        "governmentCovered": given["government"],
        "notes": given["notes"] + [
            f"{label}: {note}." for label, note in (
                ("Revenue", carried.get("revenue")),
                ("Primary balance", carried.get("primaryBalance")),
                ("Average interest rate", carried.get("averageRate")),
            ) if note
        ],
        "start": start,
        "parameters": {"priceSensitive": {"domestic": item(
            sensitive_share[start_year], given["holders_source"],
            f"price-sensitive domestic sectors as a share of all domestic sectors other than the central bank, "
            f"March {start_year}")}},
        "history": {
            name: {
                "source": source,
                "firstYear": first_unbroken_year(values, start_year),
                "values": [values[y] for y in range(first_unbroken_year(values, start_year), start_year + 1)],
                **({"note": carried[name]} if name in carried else {}),
            }
            for name, (values, source) in history.items()
        },
    })
    return country
