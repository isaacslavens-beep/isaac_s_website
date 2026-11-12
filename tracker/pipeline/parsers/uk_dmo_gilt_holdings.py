"""Parser for manual/united-kingdom/UK_gilt_holdings_by_sector_quarterly_1987-2026Q1_DMO_from_ONS.xls

The Debt Management Office's table of gilt holdings by sector, from ONS
data: millions of pounds at market value, one row per quarter.

Returns {year: {sector: millions of pounds}} for the first quarter of each
year (the end of March). The sectors are the ONS codes of the columns,
except that monetary financial institutions (NNTW) are returned as their
two parts: "bank_of_england" and "other_mfi".

The parser stops with a clear message if the file's layout is not what it
expects. It never guesses.
"""

import re

import xlrd

FILE = "UK_gilt_holdings_by_sector_quarterly_1987-2026Q1_DMO_from_ONS.xls"
SHEET = "ONS DATA main (rev)"

# Column number, ONS code and the start of the column's name.
COLUMNS = [
    (1, "NIJI", "Central Government Liabilities"),
    (2, "NJFK", "Local Government"),
    (3, "NKEQ", "Public Corporations"),
    (4, "NNTW", "Monetary Financial Institutions"),
    (5, "NIZC", "Insurance Companies and Pension funds"),
    (6, "NJSA", "Other Financial Institutions"),
    (7, "NKKY", "Private Non-Financial"),
    (8, "NISU", "Households"),
    (9, "NJLS", "Non- Profit Institutions"),
    (10, "NLDU", "Overseas Holdings"),
]
OTHER_MFI_COLUMN = 12
BANK_COLUMN = 13
TOTAL = "NIJI"


def parse(path):
    def fail(message):
        raise ValueError(f"{FILE}: {message}")

    book = xlrd.open_workbook(path)
    if SHEET not in book.sheet_names():
        fail(f"there is no sheet named '{SHEET}'")
    sheet = book.sheet_by_name(SHEET)
    if sheet.ncols < 14 or sheet.nrows < 4:
        fail("the sheet has fewer columns or rows than expected")

    names, codes = sheet.row_values(1), sheet.row_values(2)
    if str(codes[0]).strip() != "ONS Codes":
        fail("the third row does not start with 'ONS Codes'")
    for column, code, name in COLUMNS:
        if str(codes[column]).strip() != code:
            fail(f"column {column + 1} has the code '{codes[column]}', not '{code}'")
        if not str(names[column]).strip().startswith(name):
            fail(f"column {column + 1} is named '{names[column]}', which does not start with '{name}'")
    if not str(names[OTHER_MFI_COLUMN]).strip().startswith("Monetary Financial Institutions"):
        fail("column 13 is not the monetary financial institutions other than the Bank of England")
    if str(names[BANK_COLUMN]).strip() != "Bank of England":
        fail("column 14 is not named 'Bank of England'")

    result = {}
    for r in range(3, sheet.nrows):
        row = sheet.row_values(r)
        label = str(row[0]).strip()
        if not label:
            continue
        match = re.fullmatch(r"(\d{4}) Q([1-4])", label)
        if not match:
            fail(f"row {r + 1} starts with '{label}', which is not a quarter written like 2026 Q1")
        if match.group(2) != "1":
            continue
        values = {}
        for column, code, _ in COLUMNS:
            values[code] = number(row[column], fail, f"{code} in {label}")
        values["other_mfi"] = number(row[OTHER_MFI_COLUMN], fail, f"other MFIs in {label}")
        values["bank_of_england"] = number(row[BANK_COLUMN], fail, f"Bank of England in {label}")
        if abs(values["other_mfi"] + values["bank_of_england"] - values["NNTW"]) > 1.5:
            fail(f"in {label}, the Bank of England and other MFIs do not add up to all MFIs")
        del values["NNTW"]
        parts = sum(v for k, v in values.items() if k != TOTAL)
        if abs(parts - values[TOTAL]) > 5:
            fail(f"in {label}, the sectors add up to {parts:,.0f} but the total is {values[TOTAL]:,.0f}")
        result[int(match.group(1))] = values

    if not result:
        fail("found no first-quarter rows")
    return result


def number(cell, fail, where):
    if isinstance(cell, (int, float)):
        return float(cell)
    fail(f"the value '{cell}' for {where} is not a number")
