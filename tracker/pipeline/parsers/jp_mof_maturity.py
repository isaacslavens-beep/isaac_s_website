"""Parser for manual/japan/JP_average_maturity_JGBs_FY1997-2026_MoF_DMR2026.csv

Average remaining maturity of outstanding Japanese government bonds at the
end of each fiscal year, from Figure 2-18 of the Ministry of Finance's
Debt Management Report 2026. Isaac extracted the file from the report.

Returns {year: years of maturity}, where year is the calendar year the
fiscal year ends in: fiscal year 2025 is returned as 2026.

The parser stops with a clear message if the file's layout is not what it
expects. It never guesses.
"""

import csv
import re

FILE = "JP_average_maturity_JGBs_FY1997-2026_MoF_DMR2026.csv"


def parse(path):
    def fail(message):
        raise ValueError(f"{FILE}: {message}")

    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    needed = {"fiscal_year", "stock_basis_outstanding_end_of_FY", "stock_basis_years"}
    if not rows or not needed <= set(rows[0]):
        fail("the columns fiscal_year, stock_basis_outstanding_end_of_FY and stock_basis_years are not all there")

    result = {}
    for row in rows:
        if not re.fullmatch(r"\d{4}", row["fiscal_year"]):
            fail(f"'{row['fiscal_year']}' is not a fiscal year")
        text = re.fullmatch(r"(\d+) years? and (\d+) months?", row["stock_basis_outstanding_end_of_FY"].strip())
        if not text:
            fail(f"'{row['stock_basis_outstanding_end_of_FY']}' is not written like '9 years and 5 months'")
        years = int(text.group(1)) + int(text.group(2)) / 12
        if abs(years - float(row["stock_basis_years"])) > 0.001:
            fail(f"for fiscal year {row['fiscal_year']}, the two stock-basis columns disagree")
        result[int(row["fiscal_year"]) + 1] = years
    return result
