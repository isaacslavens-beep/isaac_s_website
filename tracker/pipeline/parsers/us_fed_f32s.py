"""Parser for manual/united-states/F3_2_s.csv and its data dictionary

Financial Accounts of the United States, table F3.2.s Treasury securities:
one row per period, one column per series code, in millions of dollars.
The data dictionary gives each code's description, line number and units.

Returns {"period": "2026:Q2", "values": {code: millions of dollars},
         "descriptions": {code: description}}
for the latest period in the file.

The parser stops with a clear message if the file's layout is not what it
expects. It never guesses.
"""

import csv
import re

FILE = "F3_2_s.csv"
DICTIONARY = "F3_2_s_data_dictionary.txt"


def parse(csv_path, dictionary_path):
    def fail(message):
        raise ValueError(f"{FILE}: {message}")

    # The dictionary: code, description, line, table, units, separated by tabs.
    descriptions = {}
    with open(dictionary_path, newline="") as f:
        for number, line in enumerate(f, start=1):
            cells = line.rstrip("\r\n").split("\t")
            if len(cells) != 5:
                raise ValueError(f"{DICTIONARY}: line {number} has {len(cells)} columns, expected 5")
            code, description, _, table, units = cells
            if table != "F3.2.s Treasury securities":
                raise ValueError(f"{DICTIONARY}: line {number} is for table '{table}', "
                                 "expected 'F3.2.s Treasury securities'")
            if not units.startswith("Millions of dollars; amounts outstanding end of period"):
                raise ValueError(f"{DICTIONARY}: {code} is in '{units}', expected millions of "
                                 "dollars outstanding at the end of the period")
            descriptions[code] = description

    with open(csv_path, newline="") as f:
        rows = list(csv.reader(f))
    header = rows[0]
    if header[0] != "date":
        fail("the first column is not 'date'")
    codes = header[1:]
    if set(codes) != set(descriptions):
        fail("its series codes do not match the data dictionary")

    last = rows[-1]
    if len(last) != len(header):
        fail(f"the last row has {len(last)} columns, the header has {len(header)}")
    if not re.fullmatch(r"\d{4}:Q[1-4]", last[0]):
        fail(f"the last period is '{last[0]}', not a quarter written like 2026:Q2")

    values = {}
    for code, value in zip(codes, last[1:]):
        try:
            values[code] = float(value)
        except ValueError:
            fail(f"the value '{value}' for {code} in {last[0]} is not a number")

    return {"period": last[0], "values": values, "descriptions": descriptions}
