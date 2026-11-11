"""Parser for manual/canada/CA_federal_provincial_revenue_interest_balance_by_fiscal_year_StatCan_GFS.csv

Statistics Canada, government finance statistics (table 10-10-0015-01),
in millions of dollars. Isaac built the file by adding up the quarters
from April to March of each fiscal year.

Returns {year: {"federal": {...}, "provincial": {...}}} with revenue,
interest and net_lending for each, where year is the calendar year the
fiscal year ends in: "2025-26" is returned as 2026.

The parser stops with a clear message if the file's layout is not what it
expects. It never guesses.
"""

import csv
import re

FILE = "CA_federal_provincial_revenue_interest_balance_by_fiscal_year_StatCan_GFS.csv"

LEVELS = {"federal": "Federal government", "provincial": "Provincial and territorial government"}
ITEMS = {"revenue": "Revenue", "interest": "Interest", "net_lending": "Net lending or borrowing"}


def parse(path):
    def fail(message):
        raise ValueError(f"{FILE}: {message}")

    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    header = [" ".join(cell.split()) for cell in rows[0]]
    if header[0] != "fiscal_year":
        fail("the first column is not fiscal_year")

    columns = {}
    for level, level_name in LEVELS.items():
        for item, item_name in ITEMS.items():
            heading = f"{level_name} | {item_name}"
            if header.count(heading) != 1:
                fail(f"expected one column headed '{heading}', found {header.count(heading)}")
            columns[(level, item)] = header.index(heading)

    result = {}
    for row in rows[1:]:
        match = re.fullmatch(r"(\d{4})-(\d{2})", row[0].strip())
        if not match or (int(match.group(1)) + 1) % 100 != int(match.group(2)):
            fail(f"'{row[0]}' is not a fiscal year written like 2025-26")
        year = int(match.group(1)) + 1
        values = {level: {} for level in LEVELS}
        for (level, item), column in columns.items():
            try:
                values[level][item] = float(row[column])
            except ValueError:
                fail(f"the value '{row[column]}' for {level} {item} in {row[0]} is not a number")
            if item != "net_lending" and values[level][item] <= 0:
                fail(f"{level} {item} in {row[0]} is not positive")
        result[year] = values

    years = sorted(result)
    if years != list(range(years[0], years[-1] + 1)):
        fail("the fiscal years have a gap")
    return result
