"""Parser for manual/japan/JP_central_government_debt_outstanding_quarterly_2021-2026_MoF.xls

The Ministry of Finance's table of central government debt outstanding at
each quarter end, at face value, in 100 million yen.

Returns {year: {"general": ..., "filp": ..., "bills": ...}} for the end of
March of each year: general bonds, Fiscal Investment and Loan Program
bonds, and financing bills.

The parser stops with a clear message if the file's layout is not what it
expects. It never guesses.
"""

import re

import xlrd

FILE = "JP_central_government_debt_outstanding_quarterly_2021-2026_MoF.xls"
SHEET = "suii"

# Row number, column of the label, words the label must contain, name.
ROWS = [
    (4, 1, "General Bonds", "general"),
    (10, 1, "Fiscal Investment and Loan Program Bonds", "filp"),
    (22, 0, "Financing Bills", "bills"),
]


def parse(path):
    def fail(message):
        raise ValueError(f"{FILE}: {message}")

    book = xlrd.open_workbook(path)
    if SHEET not in book.sheet_names():
        fail(f"there is no sheet named '{SHEET}'")
    sheet = book.sheet_by_name(SHEET)
    if sheet.nrows < 24:
        fail("the sheet has fewer rows than expected")
    if "Unit: 100 million yen" not in " ".join(str(cell) for cell in sheet.row_values(1)):
        fail("the second row does not say the unit is 100 million yen")

    for r, column, words, _ in ROWS:
        label = str(sheet.cell_value(r, column))
        if words not in label:
            fail(f"row {r + 1} is labelled '{label}', which does not contain '{words}'")

    result = {}
    heading = sheet.row_values(2)
    for column in range(3, sheet.ncols):
        text = str(heading[column])
        match = re.search(r"(\d{4})\s+(\w+)", text.replace("\n", " "))
        if not match:
            fail(f"the heading of column {column + 1}, '{text}', has no year and month")
        if not match.group(2).startswith("Mar"):
            continue
        values = {}
        for r, _, _, name in ROWS:
            cell = sheet.cell_value(r, column)
            if not isinstance(cell, float) or cell <= 0:
                fail(f"the value in row {r + 1} for March {match.group(1)} is not a positive number")
            values[name] = cell
        result[int(match.group(1))] = values

    if not result:
        fail("found no columns for the end of March")
    return result
