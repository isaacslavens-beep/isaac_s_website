"""Parser for manual/canada/CA_federal_marketable_debt_outstanding_and_average_term_monthly_BankOfCanada.csv

Bank of Canada: Government of Canada unmatured direct securities and
their average term to maturity, monthly.

Returns {year: years of maturity} for March of each year, from series
V37346: the average term to maturity, in months, of unmatured direct
securities excluding non-marketable securities.

The parser stops with a clear message if the file's layout is not what it
expects. It never guesses.
"""

import csv
import re

FILE = "CA_federal_marketable_debt_outstanding_and_average_term_monthly_BankOfCanada.csv"
SERIES = "V37346"
TITLE = ("V37346: Average term to maturity (months) | "
         "Unmatured direct securities (excluding non-marketable securities)")


def parse(path):
    def fail(message):
        raise ValueError(f"{FILE}: {message}")

    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    header = rows[0]
    if header[0] != "date":
        fail("the first column is not date")
    if header.count(TITLE) != 1:
        fail(f"expected one column headed '{TITLE}'")
    column = header.index(TITLE)

    result = {}
    for row in rows[1:]:
        match = re.fullmatch(r"(\d{4})-(\d{2})-01", row[0].strip())
        if not match:
            fail(f"'{row[0]}' is not a month written like 2026-03-01")
        if match.group(2) != "03" or row[column].strip() == "":
            continue
        try:
            months = float(row[column])
        except ValueError:
            fail(f"the value '{row[column]}' for {row[0]} is not a number")
        if not 6 <= months <= 360:
            fail(f"an average term of {months} months for {row[0]} is outside any plausible range")
        result[int(match.group(1))] = months / 12

    if not result:
        fail("found no March values")
    return result
