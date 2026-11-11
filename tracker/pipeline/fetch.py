"""Fetches every series listed in series.yml and saves it in cache/.

Run from anywhere:

    tracker/pipeline/.venv/bin/python tracker/pipeline/fetch.py

Before a series is used, it is checked against its service: the title must
match the one in series.yml, and the last observation must be less than a
year old. If any check or request fails, the script stops with an error and
build.py is not run, so the site keeps its last good data.

The FRED key is read from the environment variable FRED_API_KEY. On Isaac's
machine it comes from the .env file next to this script. It is passed to
FRED as a request parameter and is never printed or saved.
"""

import datetime
import json
import os
import sys
import time

import requests
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")

FRED = "https://api.stlouisfed.org/fred"
FISCALDATA = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service"
IMF = "https://www.imf.org/external/datamapper/api/v1"

PAUSE = 0.6  # seconds between requests, well inside every service's limits


def main():
    load_env_file()
    with open(os.path.join(HERE, "series.yml")) as f:
        series_list = yaml.safe_load(f)["series"]

    os.makedirs(CACHE, exist_ok=True)
    today = datetime.date.today()

    for series in series_list:
        key = series["key"]
        service = series["service"]
        if service == "fred":
            result = fetch_fred(series)
        elif service == "fiscaldata":
            result = fetch_fiscaldata(series)
        elif service == "fiscaldata_maturity":
            result = fetch_fiscaldata_maturity(series)
        elif service == "imf_datamapper":
            result = fetch_imf(series)
        else:
            stop(f"{key}: unknown service '{service}'")

        check_not_stale(key, result, today)

        result["key"] = key
        result["retrieved"] = today.isoformat()
        with open(os.path.join(CACHE, key + ".json"), "w") as f:
            json.dump(result, f)
        observations = result["observations"]
        print(f"ok  {key:22} {len(observations):5} observations, last {observations[-1][0]}")

    print("All series fetched.")


# ---------------------------------------------------------------- FRED

def fetch_fred(series):
    key = os.environ.get("FRED_API_KEY", "")
    if not key:
        stop("FRED_API_KEY is not set. Put it in tracker/pipeline/.env")

    info = get_json(FRED + "/series", {
        "series_id": series["id"], "file_type": "json", "api_key": key,
    }, secret=key)["seriess"][0]

    if info["title"] != series["title"]:
        stop(f"{series['key']}: FRED calls {series['id']} \"{info['title']}\" "
             f"but series.yml expects \"{series['title']}\"")

    data = get_json(FRED + "/series/observations", {
        "series_id": series["id"], "file_type": "json", "api_key": key,
    }, secret=key)

    observations = []
    for row in data["observations"]:
        if row["value"] != ".":  # FRED marks a missing value with a dot
            observations.append([row["date"], float(row["value"])])

    return {
        "service": "fred",
        "metadata": info,
        "observations": observations,
        "last_updated": info["last_updated"],
    }


# ---------------------------------------------------------------- U.S. Treasury Fiscal Data

def fetch_fiscaldata(series):
    rows = fiscaldata_rows(series["endpoint"], {
        "filter": series["filter"],
        "fields": "record_date," + series["field"],
        "sort": "record_date",
    })
    observations = [[row["record_date"], float(row[series["field"]])] for row in rows]
    if not observations:
        stop(f"{series['key']}: no rows matched the filter \"{series['filter']}\"")
    return {"service": "fiscaldata", "raw": rows, "observations": observations}


def fetch_fiscaldata_maturity(series):
    """Average maturity of marketable debt at each fiscal year end.

    The table lists every marketable security with its maturity date. A
    security sold in several auctions has several lines, and the amount
    outstanding appears on the first of them only. The average is weighted
    by the amount outstanding.

    Only the two latest Septembers are fetched: the table is large and the
    model needs the latest value alone.
    """
    latest = fiscaldata_rows(series["endpoint"], {
        "filter": "record_calendar_month:eq:09",
        "fields": "record_date",
        "sort": "-record_date",
    }, one_page_of=1)
    last_year = int(latest[0]["record_date"][:4])

    observations = []
    raw = {}
    for year in (last_year - 1, last_year):
        date = f"{year}-09-30"
        rows = fiscaldata_rows(series["endpoint"], {
            "filter": "record_date:eq:" + date,
            "fields": "record_date,security_class1_desc,security_class2_desc,maturity_date,outstanding_amt",
        })
        if not rows:
            stop(f"{series['key']}: no rows for {date}")
        raw[date] = rows
        observations.append([date, weighted_average_maturity(rows, date)])

    return {"service": "fiscaldata_maturity", "raw": raw, "observations": observations}


def weighted_average_maturity(rows, record_date):
    as_of = datetime.date.fromisoformat(record_date)
    weighted_years = 0.0
    total = 0.0
    for row in rows:
        if row["maturity_date"] in ("null", None) or row["outstanding_amt"] in ("null", None, "*"):
            continue  # a total line, or a later line of the same security
        matures = datetime.date.fromisoformat(row["maturity_date"])
        if matures <= as_of:
            continue  # already matured
        amount = float(row["outstanding_amt"])
        weighted_years += amount * (matures - as_of).days / 365.25
        total += amount
    if total <= 0:
        stop(f"us_maturity: found no unmatured securities for {record_date}")
    return weighted_years / total


def fiscaldata_rows(endpoint, params, one_page_of=None):
    rows = []
    page = 1
    while True:
        query = dict(params)
        query["page[size]"] = str(one_page_of or 1000)
        query["page[number]"] = str(page)
        data = get_json(FISCALDATA + endpoint, query)
        rows += data["data"]
        if one_page_of or page >= data["meta"]["total-pages"]:
            return rows
        page += 1


# ---------------------------------------------------------------- IMF

def fetch_imf(series):
    info = get_json(IMF + "/indicators", {})["indicators"][series["indicator"]]
    if info["label"] != series["title"]:
        stop(f"{series['key']}: the IMF calls {series['indicator']} \"{info['label']}\" "
             f"but series.yml expects \"{series['title']}\"")

    data = get_json(IMF + "/" + series["indicator"] + "/" + series["area"], {})
    values = data["values"][series["indicator"]][series["area"]]
    observations = [[year, float(values[year])] for year in sorted(values)]
    return {
        "service": "imf_datamapper",
        "metadata": info,  # includes which World Economic Outlook it is from
        "observations": observations,
        "last_updated": info["last-modified"],
    }


# ---------------------------------------------------------------- shared

def check_not_stale(key, result, today):
    """A series whose last observation is over a year old is treated as
    discontinued. The IMF series holds projections, so its release date is
    checked instead."""
    if result["service"] == "imf_datamapper":
        last = result["last_updated"][:10]
    else:
        last = result["observations"][-1][0]
    age = (today - datetime.date.fromisoformat(last)).days
    if age > 366:
        stop(f"{key}: the latest data is from {last}, more than a year ago. "
             "Treat the series as discontinued and find a replacement.")


def get_json(url, params, secret=None):
    time.sleep(PAUSE)
    try:
        response = requests.get(url, params=params, timeout=60)
    except requests.RequestException as error:
        # The error text can contain the full address, so only its type is shown.
        stop(f"could not reach {url} ({type(error).__name__})")
    if response.status_code != 200:
        text = response.text[:200]
        if secret:
            text = text.replace(secret, "<key>")
        stop(f"{url} answered HTTP {response.status_code}: {text}")
    return response.json()


def load_env_file():
    """Reads KEY=value lines from .env, without replacing anything already
    set in the environment (GitHub Actions sets the key there)."""
    path = os.path.join(HERE, ".env")
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                name, value = line.split("=", 1)
                os.environ.setdefault(name.strip(), value.strip())


def stop(message):
    print("FETCH FAILED: " + message, file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
