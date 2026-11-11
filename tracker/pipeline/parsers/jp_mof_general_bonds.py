"""Parser for manual/japan/JP_general_bonds_interest_payments_avg_maturity_FY2016-2026_MoF_DMR2026.csv

General bonds outstanding, their weighted average interest rate, and the
general account's interest payments, from the Ministry of Finance's Debt
Management Report 2026. Isaac extracted the file from the report.

Returns {year: {"rate": percent, "interest": trillions of yen}}, where
year is the calendar year the fiscal year ends in: fiscal year 2025 is
returned as 2026. A fiscal year with no interest rate is a budget year,
not a settled one, and is left out.

The parser stops with a clear message if the file's layout is not what it
expects. It never guesses.
"""

import csv
import re

FILE = "JP_general_bonds_interest_payments_avg_maturity_FY2016-2026_MoF_DMR2026.csv"


def parse(path):
    def fail(message):
        raise ValueError(f"{FILE}: {message}")

    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    needed = {"fiscal_year", "interest_rate_weighted_avg_pct", "general_account_interest_payments_trn_yen"}
    if not rows or not needed <= set(rows[0]):
        fail("the columns for the fiscal year, the interest rate and the interest payments are not all there")

    result = {}
    for row in rows:
        if not re.fullmatch(r"\d{4}", row["fiscal_year"]):
            fail(f"'{row['fiscal_year']}' is not a fiscal year")
        if row["interest_rate_weighted_avg_pct"].strip() == "":
            continue
        try:
            rate = float(row["interest_rate_weighted_avg_pct"])
            interest = float(row["general_account_interest_payments_trn_yen"])
        except ValueError:
            fail(f"a value for fiscal year {row['fiscal_year']} is not a number")
        if not (0 <= rate < 20 and 0 < interest < 100):
            fail(f"a value for fiscal year {row['fiscal_year']} is outside any plausible range")
        result[int(row["fiscal_year"]) + 1] = {"rate": rate, "interest": interest}
    if not result:
        fail("found no settled fiscal years")
    return result
