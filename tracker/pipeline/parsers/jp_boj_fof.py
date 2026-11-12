"""Parser for manual/japan/JP_JGB_TBill_holdings_by_sector_end_March_BoJ_FoF.csv

Bank of Japan Flow of Funds Accounts: who holds Treasury discount bills
and central government securities and FILP bonds at the end of each
fiscal year (March 31), in 100 million yen at market value. Isaac
extracted the file from the Bank of Japan's series.

Returns {year: {sector: bills plus bonds}} where year is the calendar
year the fiscal year ends in: "FY2025 (end-Mar 2026)" is returned as 2026.
Only the rows on the assets side are read. A sector with no bills row is
returned with its bonds alone.

The parser stops with a clear message if the file's layout is not what it
expects. It never guesses.
"""

import csv
import re

FILE = "JP_JGB_TBill_holdings_by_sector_end_March_BoJ_FoF.csv"
BILLS = "Treasury discount bills"
BONDS = "Central government securities and FILP bonds"
TOTAL = "Total"


def parse(path):
    def fail(message):
        raise ValueError(f"{FILE}: {message}")

    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    header = rows[0]
    if header[:4] != ["series_code", "side", "instrument", "sector"]:
        fail("the first four columns are not series_code, side, instrument, sector")
    years = []
    for cell in header[4:]:
        match = re.fullmatch(r"FY(\d{4}) \(end-Mar (\d{4})\)", cell.strip())
        if not match or int(match.group(2)) != int(match.group(1)) + 1:
            fail(f"the column heading '{cell}' is not written like 'FY2025 (end-Mar 2026)'")
        years.append(int(match.group(2)))

    result = {year: {} for year in years}
    seen = set()
    for row in rows[1:]:
        code, side, instrument, sector = (cell.strip() for cell in row[:4])
        if side not in ("Assets", "Liabilities"):
            fail(f"the row {code} has the side '{side}'")
        if instrument not in (BILLS, BONDS):
            fail(f"the row {code} has the instrument '{instrument}'")
        if side != "Assets":
            continue
        if (instrument, sector) in seen:
            fail(f"there are two rows for {sector}, {instrument}")
        seen.add((instrument, sector))
        if len(row) != len(header):
            fail(f"the row {code} has {len(row)} cells, not {len(header)}")
        for year, cell in zip(years, row[4:]):
            if cell.strip() == "":
                continue
            try:
                value = float(cell)
            except ValueError:
                fail(f"the value '{cell}' for {sector} in {year} is not a number")
            result[year][sector] = result[year].get(sector, 0.0) + value

    for year, sectors in result.items():
        if TOTAL not in sectors or sectors[TOTAL] <= 0:
            fail(f"there is no total for {year}")
    return result
