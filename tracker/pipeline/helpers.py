"""Small functions shared by build.py and march_countries.py."""

import datetime
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
MANUAL = os.path.join(HERE, "manual")
DATA = os.path.join(HERE, "..", "data")


def load(key):
    """The observations of one cached series, as [date, value] pairs in
    date order."""
    path = os.path.join(CACHE, key + ".json")
    if not os.path.exists(path):
        stop(f"{key} is not in the cache. Run fetch.py first.")
    with open(path) as f:
        return json.load(f)["observations"]


def by_year(observations):
    return {int(date[:4]): value for date, value in observations}


def quarter_start(date):
    """The first day of the quarter a date falls in: 2026-09-30 gives
    2026-07-01."""
    month = (int(date[5:7]) - 1) // 3 * 3 + 1
    return f"{date[:4]}-{month:02d}-01"


def last_values(observations, last_date, count, step_months, may_miss=0):
    """The values of the `count` periods ending at last_date, or None if
    more than `may_miss` of them are missing."""
    values = dict(observations)
    year, month = int(last_date[:4]), int(last_date[5:7])
    found = []
    for _ in range(count):
        date = f"{year}-{month:02d}-01"
        if date in values:
            found.append(values[date])
        elif count - len(found) > 0 and may_miss > 0:
            may_miss -= 1
        else:
            return None
        month -= step_months
        if month < 1:
            month += 12
            year -= 1
    return found


def last_on_or_before(observations, date, within_days):
    """The latest value dated on or before `date`, if it is no more than
    `within_days` older."""
    limit = datetime.date.fromisoformat(date)
    found = None
    for observed, value in observations:
        day = datetime.date.fromisoformat(observed)
        if day <= limit and (limit - day).days <= within_days:
            found = value
    return found


def first_unbroken_year(values, last_year):
    """The first year of the run of years, without gaps, ending at last_year."""
    year = last_year
    while year - 1 in values:
        year -= 1
    return year


def write_json(path, content):
    with open(path, "w") as f:
        json.dump(content, f, indent=2)
        f.write("\n")


def stop(message):
    print("BUILD FAILED: " + message, file=sys.stderr)
    sys.exit(1)


BASELINE_FROM = 1972   # the first full year after the dollar's link to gold ended


def baseline_inflation(inflation, last_year, source):
    """Average inflation from 1972 to the starting year, as the item
    written to the data file. The United States ended the dollar's
    convertibility into gold in August 1971, so 1972 is the first full
    year without it (Isaac, 2026-11-11). The average is compounded: the
    steady rate that gives the same rise in prices over the period."""
    level = 1.0
    for year in range(BASELINE_FROM, last_year + 1):
        if year not in inflation:
            stop(f"inflation has no value for {year}, so the average since {BASELINE_FROM} cannot be computed")
        level *= 1 + inflation[year]
    years = last_year - BASELINE_FROM + 1
    return {
        "value": level ** (1 / years) - 1,
        "source": source,
        "note": f"average inflation from {BASELINE_FROM} to {last_year}, the years since the United States "
                "ended the dollar's convertibility into gold in August 1971",
    }


def largest_five_year_average(values, last_year):
    """The largest five-year average in the unbroken run of years ending at
    last_year. Returns the average and its first and last year."""
    first = first_unbroken_year(values, last_year)
    best, best_years = None, None
    for end in range(first + 4, last_year + 1):
        average = sum(values[y] for y in range(end - 4, end + 1)) / 5
        if best is None or average > best:
            best, best_years = average, (end - 4, end)
    if best is None:
        stop("fewer than five years of primary balance history")
    return best, best_years
