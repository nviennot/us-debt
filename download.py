#!/usr/bin/env python
"""Download the data used by debt.ipynb / compile.py into data/.

Three datasets are fetched:
  * Treasury auction results, partitioned by ``record_date`` year into
    ``data/auctions_YYYY.json``.
  * CPI-U history (for TIPS inflation indexing) into ``data/cpi_u.json``.
  * Federal funds effective rate (FRED series DFF) into ``data/fed_funds.json``.

This makes the script safe to run on a daily basis:
  * Past years never change, so once downloaded their files are skipped.
  * The current year is always re-downloaded, picking up the latest auctions.

Pass --refresh-all to force a full re-download of every year.
"""

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from datetime import date

try:
    # Matches the notebook: use the OS trust store for SSL verification.
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

BASE_URL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query"
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

# The auction dataset starts in 1979.
START_YEAR = 1979

# CPI-U (all items, US city avg, not seasonally adjusted) for TIPS indexing.
CPI_CACHE = os.path.join(DATA_DIR, "cpi_u.json")
BLS_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SA0"
# Reference CPI for Jan 2000 uses CPI-U from Oct 1999, so start a year early.
CPI_START_YEAR = 1999

# Federal funds effective rate (daily), from FRED (Federal Reserve Bank of
# St. Louis). The fredgraph CSV endpoint needs no API key.
FED_FUNDS_CACHE = os.path.join(DATA_DIR, "fed_funds.json")
FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFF"


def get_text(url, retries=5):
    """Fetch a URL as text, retrying transient network errors with backoff."""
    for attempt in range(retries):
        try:
            return urllib.request.urlopen(url, timeout=60).read().decode("utf-8")
        except (urllib.error.URLError, ConnectionError) as e:
            if attempt == retries - 1:
                raise
            wait = 2 ** attempt
            print(f"  request failed ({e}); retrying in {wait}s")
            time.sleep(wait)


def get_json(url, retries=5):
    """Fetch a URL as JSON, retrying transient network errors with backoff."""
    for attempt in range(retries):
        try:
            return json.loads(urllib.request.urlopen(url, timeout=60).read())
        except (urllib.error.URLError, ConnectionError) as e:
            if attempt == retries - 1:
                raise
            wait = 2 ** attempt
            print(f"  request failed ({e}); retrying in {wait}s")
            time.sleep(wait)


def fetch_year(year):
    """Return all auction records whose record_date falls in the given year."""
    params = (
        f"filter=record_date:gte:{year}-01-01,record_date:lt:{year + 1}-01-01"
        "&sort=record_date&page[size]=1000"
    )
    records = []
    while params is not None:
        url = f"{BASE_URL}?{params}"
        d = get_json(url)
        records += d["data"]
        params = d["links"]["next"]
    return records


def fetch_cpi_range(start_year, end_year):
    """Fetch monthly CPI-U from BLS as {(year, month): value}.

    The unregistered BLS API caps each query at ~10 years, so we chunk.
    """
    out = {}
    year = start_year
    while year <= end_year:
        chunk_end = min(year + 9, end_year)
        d = get_json(f"{BLS_URL}?startyear={year}&endyear={chunk_end}")
        if d.get("status") != "REQUEST_SUCCEEDED":
            raise RuntimeError(f"BLS request failed: {d.get('message')}")
        for s in d["Results"]["series"][0]["data"]:
            period = s["period"]  # M01..M12 monthly, M13 annual average
            value = s["value"]
            if period.startswith("M") and period != "M13" and value not in ("", "-"):
                out[(int(s["year"]), int(period[1:]))] = float(value)
        year = chunk_end + 1
    return out


def download_cpi(refresh_all=False):
    """Fetch CPI-U history into data/cpi_u.json.

    Past months are immutable; the current and previous year are re-fetched to
    pick up new releases and revisions (mirrors the auction caching above).
    """
    cpi = {}
    if os.path.exists(CPI_CACHE) and not refresh_all:
        with open(CPI_CACHE) as f:
            cpi = {tuple(int(p) for p in k.split("-")): v for k, v in json.load(f).items()}

    current_year = date.today().year
    needed = set(range(CPI_START_YEAR, current_year + 1))
    have = {y for (y, _) in cpi}
    to_fetch = (needed - have) | {current_year, current_year - 1}
    to_fetch &= needed

    if to_fetch:
        cpi.update(fetch_cpi_range(min(to_fetch), current_year))
        with open(CPI_CACHE, "w") as f:
            json.dump({f"{y}-{m:02d}": v for (y, m), v in sorted(cpi.items())}, f)
        print(f"CPI-U: downloaded {len(cpi)} months -> {CPI_CACHE}")
    else:
        print("CPI-U: cached")


def download_fed_funds():
    """Fetch the daily federal funds effective rate into data/fed_funds.json.

    Stored as {"YYYY-MM-DD": rate_percent}. The full series is small, so we
    just re-download it each run (it always reflects the latest values).
    """
    text = get_text(FRED_CSV_URL)
    rates = {}
    for line in text.splitlines()[1:]:  # skip CSV header
        date_str, _, value = line.partition(",")
        value = value.strip()
        if value in ("", "."):  # FRED marks missing values with "."
            continue
        rates[date_str.strip()] = float(value)
    with open(FED_FUNDS_CACHE, "w") as f:
        json.dump(rates, f)
    print(f"Fed funds: downloaded {len(rates)} days -> {FED_FUNDS_CACHE}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--refresh-all",
        action="store_true",
        help="re-download every year instead of only the current one",
    )
    args = parser.parse_args()

    os.makedirs(DATA_DIR, exist_ok=True)
    current_year = date.today().year

    for year in range(START_YEAR, current_year + 1):
        path = os.path.join(DATA_DIR, f"auctions_{year}.json")

        # Past years are immutable: keep them unless asked to refresh everything.
        if year < current_year and os.path.exists(path) and not args.refresh_all:
            print(f"{year}: cached")
            continue

        records = fetch_year(year)
        with open(path, "w") as f:
            json.dump(records, f)
        print(f"{year}: downloaded {len(records)} records -> {path}")

    download_cpi(refresh_all=args.refresh_all)
    download_fed_funds()

    print(f"Done. Data in {DATA_DIR}")


if __name__ == "__main__":
    main()
