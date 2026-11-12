"""Parser for manual/canada/CA_federal_provincial_debt_securities_holdings_by_sector_quarterly_StatCan_36100580.csv

Statistics Canada, National Balance Sheet Accounts (table 36-10-0580-01):
federal and provincial debt securities, by the sector that holds them and
the sector that owes them, in millions of dollars, one column per quarter.
Isaac extracted the file from the table.

Returns {"holders": {year: {item: {sector: value}}},
         "owed": {year: {name: value}}}
for the first quarter of each year (the end of March). Holders are at
market value, the only valuation the table gives for every sector. The
amounts owed are at book value.

The parser stops with a clear message if the file's layout is not what it
expects. It never guesses.
"""

import csv
import re

FILE = "CA_federal_provincial_debt_securities_holdings_by_sector_quarterly_StatCan_36100580.csv"

# The three instruments whose holders the table gives.
HELD = [
    "Asset: Government of Canada bonds",
    "Asset: Government of Canada short-term paper",
    "Asset: Provincial and territorial government bonds",
]

# Amounts owed: (item, sector that owes it, name returned).
OWED = [
    ("Liability: Government of Canada bonds", "Federal general government", "federal_bonds"),
    ("Liability: Government of Canada short-term paper", "Federal general government", "federal_paper"),
    ("Liability: Provincial and territorial government bonds",
     "Provincial and territorial general governments", "provincial_bonds"),
    ("Liability: Other short-term paper", "Provincial and territorial general governments", "provincial_paper"),
]


def parse(path):
    def fail(message):
        raise ValueError(f"{FILE}: {message}")

    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    header = rows[0]
    if header[:4] != ["side_and_item", "Sectors", "Valuation", "VECTOR"]:
        fail("the first four columns are not side_and_item, Sectors, Valuation, VECTOR")
    columns = {}
    for index, cell in enumerate(header[4:], start=4):
        match = re.fullmatch(r"(\d{4})Q([1-4])", cell.strip())
        if not match:
            fail(f"the column heading '{cell}' is not a quarter written like 2026Q1")
        if match.group(2) == "1":
            columns[int(match.group(1))] = index

    table = {}
    for row in rows[1:]:
        key = (row[0].strip(), row[1].strip(), row[2].strip())
        if key[2] not in ("Market value", "Book value"):
            fail(f"the row {row[3]} has the valuation '{key[2]}'")
        if key in table:
            fail(f"there are two rows for {key}")
        table[key] = row

    def value(key, year):
        cell = table[key][columns[year]].strip()
        if cell == "":
            return None
        try:
            return float(cell)
        except ValueError:
            fail(f"the value '{cell}' for {key} in {year} Q1 is not a number")

    holders, owed = {}, {}
    for year in columns:
        year_holders = {}
        for item in HELD:
            sectors = {}
            for key in table:
                if key[0] == item and key[2] == "Market value":
                    number = value(key, year)
                    if number is not None:
                        sectors[key[1]] = number
            if "Total all sectors" in sectors:
                year_holders[item] = sectors
        if len(year_holders) == len(HELD):
            holders[year] = year_holders

        year_owed = {}
        for item, sector, name in OWED:
            key = (item, sector, "Book value")
            if key not in table:
                fail(f"there is no book value row for {item}, {sector}")
            number = value(key, year)
            if number is not None:
                year_owed[name] = number
        if len(year_owed) == len(OWED):
            owed[year] = year_owed

    if not holders or not owed:
        fail("found no first quarter with every series")
    return {"holders": holders, "owed": owed}
