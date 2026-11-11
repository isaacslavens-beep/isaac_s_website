"""Parser for manual/japan/JP_general_account_revenue_by_item_settlement_FY1982on_MoF_table4_JA.xlsx

Ministry of Finance, table 4: settled general account revenue by main
item from fiscal year 1982, in millions of yen. The file is in Japanese.

Returns {year: {"total": ..., "bonds": ..., "carried": ...}} where year is
the calendar year the fiscal year ends in (fiscal year 2024 is returned as
2025). "bonds" is the proceeds of government bond issues (公債金) and
"carried" is the surplus received from the previous year (前年度剰余金受入).

The parser stops with a clear message if the file's layout is not what it
expects. It never guesses.
"""

import unicodedata
import warnings

import openpyxl

FILE = "JP_general_account_revenue_by_item_settlement_FY1982on_MoF_table4_JA.xlsx"
SHEET = "4表"
ERAS = {"昭和": 1925, "平成": 1988, "令和": 2018}   # era year 1 is this number plus 1
COLUMNS = {13: ("公債金", "bonds"), 14: ("前年度剰余金受入", "carried"), 15: ("合計", "total")}


def clean(cell):
    """The cell's text without spaces, with full-width digits made plain."""
    return "" if cell is None else "".join(unicodedata.normalize("NFKC", str(cell)).split())


def parse(path):
    def fail(message):
        raise ValueError(f"{FILE}: {message}")

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    if SHEET not in book.sheetnames:
        fail(f"there is no sheet named '{SHEET}'")
    rows = list(book[SHEET].iter_rows(values_only=True))

    if "百万円" not in "".join(clean(cell) for cell in rows[2]):
        fail("the third row does not say the unit is millions of yen (百万円)")
    for column, (label, _) in COLUMNS.items():
        if clean(rows[3][column]) != label:
            fail(f"column {column + 1} is headed '{clean(rows[3][column])}', not '{label}'")

    result = {}
    era = None
    for row in rows[6:]:
        if clean(row[0]) in ERAS:
            era = clean(row[0])
        number = clean(row[1])
        if number == "":
            if result:
                break          # the blank row after the last fiscal year
            continue
        if era is None:
            fail("a fiscal year comes before any era name")
        era_year = 1 if number == "元" else int(number) if number.isdigit() else None
        if era_year is None:
            fail(f"'{number}' is not a year of the {era} era")
        fiscal_year = ERAS[era] + era_year
        values = {}
        for column, (label, name) in COLUMNS.items():
            if not isinstance(row[column], (int, float)):
                fail(f"the value of {label} for fiscal year {fiscal_year} is not a number")
            values[name] = float(row[column])
        if fiscal_year + 1 in result:
            fail(f"fiscal year {fiscal_year} appears twice")
        result[fiscal_year + 1] = values

    years = sorted(result)
    if not years or years[0] != 1983 or years != list(range(years[0], years[-1] + 1)):
        fail("the fiscal years do not run from 1982 without a gap")
    return result
