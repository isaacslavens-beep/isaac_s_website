"""Parser for manual/united-kingdom/UK_debt_portfolio_outstanding_and_average_maturity_quarterly_2004-2026_DMO.xls

The Debt Management Office's debt portfolio table, net of government
holdings: one column per quarter end.

Returns {year: {"debt": billions of pounds, "maturity": years}} for the
end of March of each year (the last business day of the month). Debt is the uplifted nominal value of all gilts
and Treasury bills; maturity is their average maturity based on nominal
values.

The parser stops with a clear message if the file's layout is not what it
expects. It never guesses.
"""

import xlrd

FILE = "UK_debt_portfolio_outstanding_and_average_maturity_quarterly_2004-2026_DMO.xls"
SHEET = "Table data (net)"
ALL = "• All Gilts + TBills"


def parse(path):
    def fail(message):
        raise ValueError(f"{FILE}: {message}")

    book = xlrd.open_workbook(path)
    if SHEET not in book.sheet_names():
        fail(f"there is no sheet named '{SHEET}'")
    sheet = book.sheet_by_name(SHEET)
    labels = [str(cell).strip() for cell in sheet.col_values(0)]
    if labels[0] != "Statistic":
        fail("the first cell is not 'Statistic'")

    def row_after(heading):
        """The 'All Gilts + TBills' row directly under a heading."""
        if labels.count(heading) != 1:
            fail(f"expected one row named '{heading}', found {labels.count(heading)}")
        r = labels.index(heading) + 1
        if r >= len(labels) or labels[r] != ALL:
            fail(f"the row under '{heading}' is not '{ALL}'")
        return sheet.row_values(r)

    debt = row_after("Uplifted Nominal Value (£Billion)")
    maturity = row_after("Average Maturity (years) - based on nominal values")
    dates = sheet.row_values(0)

    result = {}
    for column in range(1, sheet.ncols):
        if not isinstance(dates[column], float):
            fail(f"the heading of column {column + 1} is not a date")
        year, month, day = xlrd.xldate_as_tuple(dates[column], book.datemode)[:3]
        if month != 3:
            continue
        # The column is dated the last business day of March.
        if day < 26 or year in result:
            fail(f"expected one column for the end of March {year}")
        if not isinstance(debt[column], float) or not isinstance(maturity[column], float):
            fail(f"a value for March {year} is not a number")
        if not (0 < maturity[column] < 40 and debt[column] > 0):
            fail(f"a value for March {year} is outside any plausible range")
        result[year] = {"debt": debt[column], "maturity": maturity[column]}

    if not result:
        fail("found no columns for the end of March")
    return result
