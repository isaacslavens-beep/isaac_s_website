"""Parser for manual/japan/JP_general_account_expenditure_by_category_settlement_incl_debt_service_MoF_table20_JA.xlsx

Ministry of Finance, table 20: settled general account expenditure by
main category, one sheet per fiscal year from 1967, in thousands of yen.
The file is in Japanese.

Returns {year: {"total": ..., "debt_service": ...}} in thousands of yen,
where year is the calendar year the fiscal year ends in (the sheet 令和6,
fiscal year 2024, is returned as 2025). "debt_service" is national debt
service (国債費): interest and redemption together.

The parser stops with a clear message if the file's layout is not what it
expects. It never guesses.
"""

import re
import unicodedata
import warnings

import openpyxl

FILE = "JP_general_account_expenditure_by_category_settlement_incl_debt_service_MoF_table20_JA.xlsx"
ERAS = {"昭和": 1925, "平成": 1988, "令和": 2018}
ROWS = {"国債費": "debt_service", "合計": "total"}
NOTES_SHEET = "（注）"
SETTLED_COLUMN = 4   # 決算額, the settled amount


def clean(cell):
    """The cell's text without spaces, with full-width digits made plain."""
    return "" if cell is None else "".join(unicodedata.normalize("NFKC", str(cell)).split())


def parse(path):
    def fail(message):
        raise ValueError(f"{FILE}: {message}")

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        book = openpyxl.load_workbook(path, read_only=True, data_only=True)

    result = {}
    for sheet_name in book.sheetnames:
        if sheet_name == NOTES_SHEET:
            continue
        match = re.fullmatch(r"(昭和|平成|令和)(元|\d+)", sheet_name)
        if not match:
            fail(f"the sheet name '{sheet_name}' is not an era and a year")
        era_year = 1 if match.group(2) == "元" else int(match.group(2))
        fiscal_year = ERAS[match.group(1)] + era_year

        rows = list(book[sheet_name].iter_rows(values_only=True))
        top = "".join(clean(cell) for row in rows[:4] for cell in row)
        if "千円" not in top:
            fail(f"sheet {sheet_name}: the unit is not given as thousands of yen (千円)")
        if match.group(1) + match.group(2) + "年度" not in top:
            fail(f"sheet {sheet_name}: the heading does not name the same fiscal year as the sheet")
        if clean(rows[3][SETTLED_COLUMN]) != "決算額":
            fail(f"sheet {sheet_name}: column {SETTLED_COLUMN + 1} is not the settled amount (決算額)")

        values = {}
        for row in rows[4:]:
            label = clean(row[1])
            if label in ROWS:
                if ROWS[label] in values:
                    fail(f"sheet {sheet_name}: there are two rows named {label}")
                if not isinstance(row[SETTLED_COLUMN], (int, float)):
                    fail(f"sheet {sheet_name}: the settled amount of {label} is not a number")
                values[ROWS[label]] = float(row[SETTLED_COLUMN])
        if len(values) != len(ROWS):
            fail(f"sheet {sheet_name}: did not find both 国債費 and 合計")
        if not 0 < values["debt_service"] < values["total"]:
            fail(f"sheet {sheet_name}: debt service is not smaller than total expenditure")
        result[fiscal_year + 1] = values

    years = sorted(result)
    if years != list(range(years[0], years[-1] + 1)):
        fail("the fiscal years have a gap")
    return result
