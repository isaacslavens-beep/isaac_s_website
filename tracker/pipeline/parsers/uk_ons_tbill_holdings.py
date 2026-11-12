"""Parser for manual/united-kingdom/UK_TBill_holdings_by_sector_quarterly_ONS_UKEA.csv

Sterling Treasury bills held by each sector, from the ONS UK Economic
Accounts: millions of pounds, one row per quarter. Isaac extracted the
file from the ONS dataset; the first row holds the ONS series codes and
the second their titles.

Returns {year: {code: millions of pounds}} for the first quarter of each
year (the end of March), for the years in which every series has a value.

The parser stops with a clear message if the file's layout is not what it
expects. It never guesses.
"""

import csv
import re

FILE = "UK_TBill_holdings_by_sector_quarterly_ONS_UKEA.csv"

# ONS code and words its title must contain.
SERIES = {
    "NIIV": "CG:LI:LEVEL:Sterling treasury bills",          # the total issued
    "NLDH": "RW:AS:LEVEL:Sterling treasury bills",          # rest of the world
    "NNTJ": "Sterling treasury bills",                      # monetary financial institutions
    "NIYP": "Sterling treasury bills",                      # insurance companies and pension funds
    "NJRN": "Sterling treasury bills",                      # other financial institutions
    "NKED": "Sterling treasury bills",                      # public corporations
    "NKKL": "Sterling treasury bills",                      # private non-financial companies
    "NISH": "Sterling treasury bills",                      # households
    "NJLF": "Sterling treasury bills",                      # non-profit institutions
    "NJEX": "",                                             # local authorities
}
TOTAL = "NIIV"


def parse(path):
    def fail(message):
        raise ValueError(f"{FILE}: {message}")

    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    if len(rows) < 5 or rows[0][0] != "period" or rows[1][0] != "title":
        fail("the first two rows do not start with 'period' and 'title'")
    header, titles = rows[0], rows[1]
    columns = {}
    for code, words in SERIES.items():
        if header.count(code) != 1:
            fail(f"expected one column with the code {code}, found {header.count(code)}")
        columns[code] = header.index(code)
        if words.lower() not in titles[columns[code]].lower():
            fail(f"the title of {code} is '{titles[columns[code]]}', which does not contain '{words}'")

    result = {}
    for row in rows[2:]:
        match = re.fullmatch(r"(\d{4}) Q1", row[0].strip())
        if not match:
            continue
        cells = {code: row[column].strip() for code, column in columns.items()}
        if any(cell == "" for cell in cells.values()):
            continue  # a year before every series starts
        try:
            values = {code: float(cell) for code, cell in cells.items()}
        except ValueError:
            fail(f"a value in the row {row[0]} is not a number")
        parts = sum(v for k, v in values.items() if k != TOTAL)
        if abs(parts - values[TOTAL]) > max(5, 0.001 * values[TOTAL]):
            fail(f"in {row[0]}, the sectors add up to {parts:,.0f} but the total is {values[TOTAL]:,.0f}")
        result[int(match.group(1))] = values

    if not result:
        fail("found no first-quarter rows with every series")
    return result
