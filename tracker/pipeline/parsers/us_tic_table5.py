"""Parser for manual/united-states/slt_table5.txt

TIC Table 5, Major Foreign Holders of Treasury Securities: the latest
thirteen months, in billions of dollars, one column per month.

Returns {"2026-08": {"japan": ..., "total": ..., "official": ...}, ...}

The parser stops with a clear message if the file's layout is not what it
expects. It never guesses.
"""

import re

FILE = "slt_table5.txt"

ROWS = {
    "Japan": "japan",
    "Grand Total": "total",
    "Of Which: Foreign Official": "official",
}


def parse(path):
    with open(path, newline="") as f:
        lines = [line.rstrip("\r\n").split("\t") for line in f]

    def fail(message):
        raise ValueError(f"{FILE}: {message}")

    if not lines or lines[0][0].strip() != "Table 5: Major Foreign Holders of Treasury Securities":
        fail("the first line is not 'Table 5: Major Foreign Holders of Treasury Securities'")
    if lines[2][0].strip() != "Billions of dollars":
        fail("the third line is not 'Billions of dollars'")

    headers = [cells for cells in lines if cells[0].strip() == "Country"]
    if len(headers) != 1:
        fail(f"expected one header row starting with 'Country', found {len(headers)}")
    months = [cell.strip() for cell in headers[0][1:] if cell.strip()]
    for month in months:
        if not re.fullmatch(r"\d{4}-\d{2}", month):
            fail(f"the column heading '{month}' is not a month written like 2026-08")

    result = {month: {} for month in months}
    for label, name in ROWS.items():
        matches = [cells for cells in lines if cells[0].strip() == label]
        if len(matches) != 1:
            fail(f"expected one row named '{label}', found {len(matches)}")
        values = matches[0][1:len(months) + 1]
        if len(values) != len(months):
            fail(f"the row '{label}' has {len(values)} values for {len(months)} months")
        for month, value in zip(months, values):
            try:
                result[month][name] = float(value)
            except ValueError:
                fail(f"the value '{value}' for {label} in {month} is not a number")

    for month, row in result.items():
        if not (0 < row["japan"] < row["total"] and 0 < row["official"] < row["total"]):
            fail(f"in {month}, Japan or Foreign Official is not smaller than the Grand Total")
    return result
