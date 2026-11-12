"""Parser for manual/united-states/mfhhis01.txt

The historical Major Foreign Holders of Treasury Securities table: one
block per calendar year, newest first, in billions of dollars. Each block
has a row of month names, then a row starting with "Country" that repeats
the year, then one row per country, a "Grand Total" row and a
"For. Official" row.

Only September is read, because the model's year ends on September 30.
Some blocks show June twice (a series break) and lay January out
differently; September appears exactly once in every block.

Returns {2025: {"japan": ..., "total": ..., "official": ...}, ...}

The parser stops with a clear message if the file's layout is not what it
expects. It never guesses.
"""

FILE = "mfhhis01.txt"

ROWS = {
    "Japan": "japan",
    "Grand Total": "total",
    "For. Official": "official",
}


def parse(path):
    with open(path, newline="") as f:
        lines = [line.rstrip("\r\n").split("\t") for line in f]

    def fail(message):
        raise ValueError(f"{FILE}: {message}")

    if "MAJOR FOREIGN HOLDERS OF TREASURY SECURITIES" not in "".join(lines[0]):
        fail("the first line is not 'MAJOR FOREIGN HOLDERS OF TREASURY SECURITIES'")
    if "(in billions of dollars)" not in "".join(lines[1]):
        fail("the second line is not '(in billions of dollars)'")

    # A block starts at each row whose first cell is "Country".
    starts = [n for n, cells in enumerate(lines) if cells[0].strip() == "Country"]
    if not starts:
        fail("found no row starting with 'Country'")

    result = {}
    for position, start in enumerate(starts):
        end = starts[position + 1] - 1 if position + 1 < len(starts) else len(lines)
        months = [cell.strip() for cell in lines[start - 1]]
        years = [cell.strip() for cell in lines[start]]

        columns = [n for n, month in enumerate(months) if month == "Sep"]
        if len(columns) != 1:
            fail(f"line {start}: expected one 'Sep' column in the month row, found {len(columns)}")
        column = columns[0]
        if not years[column].isdigit() or len(years[column]) != 4:
            fail(f"line {start + 1}: the year under 'Sep' is '{years[column]}', not a year")
        year = int(years[column])
        if year in result:
            fail(f"the year {year} appears in two blocks")

        block = lines[start + 1:end]
        row = {}
        for label, name in ROWS.items():
            matches = [cells for cells in block if cells[0].strip() == label]
            if len(matches) != 1:
                fail(f"{year}: expected one row named '{label}', found {len(matches)}")
            value = matches[0][column] if column < len(matches[0]) else ""
            try:
                row[name] = float(value)
            except ValueError:
                fail(f"{year}: the September value '{value}' for {label} is not a number")
        if not (0 < row["japan"] < row["total"] and 0 < row["official"] < row["total"]):
            fail(f"{year}: Japan or For. Official is not smaller than the Grand Total")
        result[year] = row

    found = sorted(result)
    if found != list(range(found[0], found[-1] + 1)):
        fail(f"the years are not continuous: {found}")
    return result
