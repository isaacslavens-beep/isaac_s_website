"""Parser for manual/united-kingdom/UK_public_sector_finances_appendixA_Sep2026_ONS_incl_central_govt_tables_PSA6.xlsx

The ONS public sector finances tables. Two sheets of the central
government account are read, in millions of pounds:

    PSA6B_1  ANBV   total current receipts
    PSA6B_2  NMFX   interest paid
    PSA6B_2  -NMFJ  net borrowing

Returns {year: {"receipts": ..., "interest": ..., "net_borrowing": ...}}
for financial years, named by the year they end in: the row
"Apr 2025 to Mar 2026" is returned as 2026.

The parser stops with a clear message if the file's layout is not what it
expects. It never guesses.
"""

import re
import warnings

import openpyxl

FILE = "UK_public_sector_finances_appendixA_Sep2026_ONS_incl_central_govt_tables_PSA6.xlsx"

WANTED = [
    ("PSA6B_1", "ANBV", "Total current receipts", "receipts"),
    ("PSA6B_2", "NMFX", "Current expenditure, of which Interest", "interest"),
    ("PSA6B_2", "-NMFJ", "Net borrowing", "net_borrowing"),
]


def parse(path):
    def fail(message):
        raise ValueError(f"{FILE}: {message}")

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        book = openpyxl.load_workbook(path, read_only=True, data_only=True)

    sheets = {}
    result = {}
    for sheet_name, code, heading, name in WANTED:
        if sheet_name not in sheets:
            if sheet_name not in book.sheetnames:
                fail(f"there is no sheet named '{sheet_name}'")
            sheets[sheet_name] = list(book[sheet_name].iter_rows(values_only=True))
        rows = sheets[sheet_name]
        if len(rows) < 7 or rows[4][0] != "Time period" or rows[5][0] != "Dataset identifier code":
            fail(f"{sheet_name}: rows 5 and 6 are not the headings and the dataset identifier codes")
        codes = [str(cell).strip() if cell is not None else "" for cell in rows[5]]
        if codes.count(code) != 1:
            fail(f"{sheet_name}: expected one column with the code {code}, found {codes.count(code)}")
        column = codes.index(code)
        if "£ million" not in str(rows[4][column]) or not str(rows[4][column]).startswith(heading):
            fail(f"{sheet_name}: the column {code} is headed '{rows[4][column]}', "
                 f"not '{heading}' in millions of pounds")

        found = 0
        for row in rows[6:]:
            match = re.fullmatch(r"Apr (\d{4}) to Mar (\d{4})", str(row[0] or "").strip())
            if not match:
                continue
            if int(match.group(2)) != int(match.group(1)) + 1:
                fail(f"{sheet_name}: the row '{row[0]}' does not cover one financial year")
            if not isinstance(row[column], (int, float)):
                fail(f"{sheet_name}: the value of {code} for '{row[0]}' is not a number")
            result.setdefault(int(match.group(2)), {})[name] = float(row[column])
            found += 1
        if found < 20:
            fail(f"{sheet_name}: found only {found} financial-year rows")

    incomplete = [year for year, values in result.items() if len(values) != len(WANTED)]
    if incomplete:
        fail(f"the financial years ending {incomplete} do not have all three series")
    return result
