#!/usr/bin/env python
"""Compile weekly US debt by bond term into results.json.

Reproduces the "Debt over the years" computation from debt.ipynb:
for each auction, its total_accepted amount counts as outstanding debt on every
day between its issue_date and maturity_date, classified into a term bracket.

We also reproduce the "Cost of Interests" computation: each auction contributes
total_accepted * rate as annual interest cost on every day it is outstanding,
where rate is int_rate (Bonds/Notes) or high_investment_rate (Bills).

For TIPS, the coupon is paid on the inflation-adjusted principal, so we scale
their interest by the Treasury reference-CPI index ratio on each date
(refCPI(date) / ref_cpi_on_dated_date), using CPI-U history that download.py
fetches into data/cpi_u.json. Bills keep the high_investment_rate
coupon-equivalent. The debt series itself is left at par (face value).

We then sample the resulting daily series weekly, starting in 2000, and write
results.json with this structure (all y-series are per term bracket, aligned to
the shared x dates):

  {
    "labels": [<bracket label>, ...],          # 4 term brackets
    "x":      [<"YYYY-MM-DD">, ...],            # weekly dates, length W
    "debt":          [[...W...], ...],          # debt outstanding, dollars
    "interest_cost": [[...W...], ...],          # annual interest cost, dollars/year
    "issue_rate": [[...W...], ...],             # coupon rate of that week's issues, %
    "fed_rate":   [...W...],                     # federal funds effective rate, %
  }

Each of debt / interest_cost / issue_rate is a list of 4 brackets (matching labels),
and each bracket is a list of W weekly values aligned to x. issue_rate is the
amount-weighted coupon rate of securities issued during each week (null when a
bracket had no issuance that week). fed_rate is a single W-length series.
"""

import calendar
import bisect
import glob
import json
import os
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
OUTPUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results.json")

# CPI-U history (for TIPS indexing) is fetched by download.py into this file.
CPI_CACHE = os.path.join(DATA_DIR, "cpi_u.json")

# Federal funds effective rate (daily) fetched by download.py.
FED_FUNDS_CACHE = os.path.join(DATA_DIR, "fed_funds.json")

YEAR = 365.25

# Right boundaries of each term bracket (in days), same as the notebook.
brackets = np.array([
    0.7 * YEAR,   # <= 6 months
    3.5 * YEAR,   # 6 months - 3 years
    9.0 * YEAR,   # 3 - 9 years (4, 5, 7 year notes)
    100 * YEAR,   # 9 - 30 years (10, 20, 30 year bonds)
], dtype=np.int64)

brackets_labels = [
    "≤ 6 months",
    "1 - 3 years",
    "4 - 7 years",
    "10 - 30 years",
]

# Full day range used to accumulate debt (covers all issue/maturity spans).
START_DAY = datetime(1979, 1, 1)
END_DAY = datetime(2060, 1, 1)

# Weekly sampling starts here.
SAMPLE_START = datetime(2000, 1, 1)


def load_data():
    paths = sorted(glob.glob(os.path.join(DATA_DIR, "auctions_*.json")))
    if not paths:
        raise FileNotFoundError("No data found in data/. Run `python download.py` first.")
    data = []
    for path in paths:
        with open(path) as f:
            data += json.load(f)
    # Treasury API encodes nulls as the string "null".
    return json.loads(json.dumps(data).replace('"null"', "null"))


def load_cpi():
    """Return CPI-U as {(year, month): value} from data/cpi_u.json.

    The file is produced by download.py (CPI-U history from the BLS API).
    """
    if not os.path.exists(CPI_CACHE):
        raise FileNotFoundError(
            f"{CPI_CACHE} not found. Run `python download.py` first."
        )
    with open(CPI_CACHE) as f:
        return {tuple(int(p) for p in k.split("-")): v for k, v in json.load(f).items()}


def load_fed_funds():
    """Return the daily federal funds rate as sorted [(date, percent), ...]."""
    if not os.path.exists(FED_FUNDS_CACHE):
        raise FileNotFoundError(
            f"{FED_FUNDS_CACHE} not found. Run `python download.py` first."
        )
    with open(FED_FUNDS_CACHE) as f:
        d = json.load(f)
    return sorted((datetime.strptime(k, "%Y-%m-%d"), v) for k, v in d.items())


def sample_fed_funds(fed, week_dates):
    """Federal funds rate at each week date, carrying the last value forward."""
    dates = [d for d, _ in fed]
    values = [v for _, v in fed]
    out = []
    for wd in week_dates:
        i = bisect.bisect_right(dates, wd) - 1
        out.append(values[i] if i >= 0 else None)
    return out


def cpi_lookup(cpi, year, month):
    """CPI-U for (year, month), carrying the latest value forward if missing."""
    if (year, month) in cpi:
        return cpi[(year, month)]
    return cpi[max(k for k in cpi if k <= (year, month))]


def reference_cpi(d, cpi):
    """Treasury reference CPI for a date: CPI-U lagged 3 months, interpolated.

    RefCPI(date) = RefCPI(1st of month) + (day-1)/(days in month) *
                   (RefCPI(1st of next month) - RefCPI(1st of month)),
    where RefCPI(1st of a month) is the CPI-U from 3 calendar months earlier.
    """
    def ref_first(year, month):
        mm, yy = month - 3, year
        while mm <= 0:
            mm += 12
            yy -= 1
        return cpi_lookup(cpi, yy, mm)

    r0 = ref_first(d.year, d.month)
    ny, nm = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    r1 = ref_first(ny, nm)
    days_in_month = calendar.monthrange(d.year, d.month)[1]
    return r0 + (d.day - 1) / days_in_month * (r1 - r0)


def build_df(data):
    df = pd.DataFrame(data)
    df["issue_date"] = pd.to_datetime(df["issue_date"])
    df["maturity_date"] = pd.to_datetime(df["maturity_date"])
    df["total_accepted"] = pd.array(df["total_accepted"], dtype=pd.Int64Dtype())
    df["int_rate"] = pd.to_numeric(df["int_rate"], errors="coerce")
    df["term"] = df["maturity_date"] - df["issue_date"]
    return df


def compute_daily_debt(df):
    num_days = (END_DAY - START_DAY).days
    # Difference array per bracket: +amount on issue day, -amount on maturity day.
    # Cumulative sum then gives outstanding debt on each day, matching the
    # notebook's per-day accumulation over [issue_date, maturity_date).
    diff = np.zeros((len(brackets), num_days + 1), dtype=np.int64)

    for issue, maturity, term, amount in zip(
        df["issue_date"], df["maturity_date"], df["term"], df["total_accepted"]
    ):
        if pd.isna(issue) or pd.isna(maturity) or pd.isna(amount):
            continue
        bracket_i = int(np.searchsorted(brackets, term.days))
        issue_i = (issue.to_pydatetime() - START_DAY).days
        maturity_i = (maturity.to_pydatetime() - START_DAY).days
        if maturity_i <= issue_i:
            continue
        issue_i = max(0, min(issue_i, num_days))
        maturity_i = max(0, min(maturity_i, num_days))
        diff[bracket_i, issue_i] += int(amount)
        diff[bracket_i, maturity_i] -= int(amount)

    return np.cumsum(diff[:, :-1], axis=1)


def compute_daily_interest(df):
    num_days = (END_DAY - START_DAY).days
    # Annual interest cost contributed by each security while outstanding.
    # Same diff-then-cumsum trick, but the increment is amount * rate.
    diff = np.zeros((len(brackets), num_days + 1), dtype=np.float64)

    for issue, maturity, term, amount, int_rate, high_inv in zip(
        df["issue_date"], df["maturity_date"], df["term"],
        df["total_accepted"], df["int_rate"], df["high_investment_rate"],
    ):
        if pd.isna(issue) or pd.isna(maturity) or pd.isna(amount):
            continue
        # Bonds have int_rate; Bills/Notes use high_investment_rate instead.
        rate = int_rate
        if pd.isna(rate):
            if pd.isna(high_inv):
                continue
            try:
                rate = float(high_inv)
            except (TypeError, ValueError):
                continue
            if pd.isna(rate):
                continue
        bracket_i = int(np.searchsorted(brackets, term.days))
        issue_i = (issue.to_pydatetime() - START_DAY).days
        maturity_i = (maturity.to_pydatetime() - START_DAY).days
        if maturity_i <= issue_i:
            continue
        issue_i = max(0, min(issue_i, num_days))
        maturity_i = max(0, min(maturity_i, num_days))
        annual = int(amount) * (rate / 100.0)
        diff[bracket_i, issue_i] += annual
        diff[bracket_i, maturity_i] -= annual

    return np.cumsum(diff[:, :-1], axis=1)


def compute_tips_interest_sampled(tips_df, week_dates, cpi):
    """Inflation-adjusted annual TIPS interest at each weekly sample date.

    TIPS coupons are paid on principal scaled by the index ratio
    refCPI(date) / ref_cpi_on_dated_date, so the run-rate varies day to day and
    can't use the constant-increment diff trick. With only ~266 TIPS we evaluate
    each one across the sample dates directly.
    """
    out = np.zeros((len(brackets), len(week_dates)), dtype=np.float64)
    week_ts = np.array([np.datetime64(d) for d in week_dates])
    refcpi = np.array([reference_cpi(d, cpi) for d in week_dates], dtype=np.float64)

    ref_base = pd.to_numeric(tips_df["ref_cpi_on_dated_date"], errors="coerce")
    for issue, maturity, term, amount, rate, base in zip(
        tips_df["issue_date"], tips_df["maturity_date"], tips_df["term"],
        tips_df["total_accepted"], tips_df["int_rate"], ref_base,
    ):
        if pd.isna(issue) or pd.isna(maturity) or pd.isna(amount) or pd.isna(rate) or pd.isna(base):
            continue
        bracket_i = int(np.searchsorted(brackets, term.days))
        base_annual = int(amount) * (rate / 100.0)
        ratio = refcpi / float(base)
        outstanding = (week_ts >= issue.to_datetime64()) & (week_ts < maturity.to_datetime64())
        out[bracket_i] += np.where(outstanding, base_annual * ratio, 0.0)
    return out


def compute_weekly_issue_rate(df, week_dates, windows=(8, 13, 21, 26)):
    """Amount-weighted coupon rate of securities issued, over a trailing window.

    A single week's issuance is very noisy (different bill/note maturities each
    week, reopenings carrying old coupons), so we average over a trailing window,
    weighting by issue amount. This also fills the gaps left by infrequently-
    issued long-term bonds. The window length is per bracket (`windows`, in
    weeks), since short-term bills issue often (small window) while long bonds
    issue rarely (larger window). Weeks with no issuance in the window stay NaN.
    """
    n = len(week_dates)
    weighted = np.zeros((len(brackets), n), dtype=np.float64)
    amounts = np.zeros((len(brackets), n), dtype=np.float64)

    for issue, term, amount, int_rate, high_inv in zip(
        df["issue_date"], df["term"], df["total_accepted"],
        df["int_rate"], df["high_investment_rate"],
    ):
        if pd.isna(issue) or pd.isna(term) or pd.isna(amount):
            continue
        # Bonds have int_rate; Bills/Notes use high_investment_rate instead.
        rate = int_rate
        if pd.isna(rate):
            if pd.isna(high_inv):
                continue
            try:
                rate = float(high_inv)
            except (TypeError, ValueError):
                continue
            if pd.isna(rate):
                continue
        week_i = (issue.to_pydatetime() - SAMPLE_START).days // 7
        if week_i < 0 or week_i >= n:
            continue
        bracket_i = int(np.searchsorted(brackets, term.days))
        amt = int(amount)
        weighted[bracket_i, week_i] += amt * rate
        amounts[bracket_i, week_i] += amt

    # Trailing window sum of one row, over `window` weeks.
    def trailing(row, window):
        c = np.cumsum(row)
        shifted = np.zeros_like(c)
        shifted[window:] = c[:-window]
        return c - shifted

    rate = np.full((len(brackets), n), np.nan)
    for b in range(len(brackets)):
        win_weighted = trailing(weighted[b], windows[b])
        win_amounts = trailing(amounts[b], windows[b])
        nz = win_amounts > 0
        rate[b, nz] = win_weighted[nz] / win_amounts[nz]
    return rate


def main():
    df = build_df(load_data())
    cpi = load_cpi()
    debt = compute_daily_debt(df)

    # Non-TIPS interest via the fast daily accumulation; TIPS handled separately
    # because their coupon base is inflation-adjusted over time.
    tips_mask = df["inflation_index_security"] == "Yes"
    interest_non_tips = compute_daily_interest(df[~tips_mask])

    today = datetime.today()
    week_dates = []
    d = SAMPLE_START
    while d <= today:
        week_dates.append(d)
        d += timedelta(weeks=1)

    indices = [(d - START_DAY).days for d in week_dates]
    sampled = debt[:, indices]  # shape (brackets, weeks)
    sampled_interest = interest_non_tips[:, indices].astype(np.float64)
    sampled_interest += compute_tips_interest_sampled(df[tips_mask], week_dates, cpi)

    # Coupon rate of securities issued during each week (percent), per bond term.
    issue_rate = compute_weekly_issue_rate(df, week_dates)

    # Federal funds effective rate sampled at each week.
    fed_rate = sample_fed_funds(load_fed_funds(), week_dates)

    def jsonable(arr):
        # JSON has no NaN; emit null for weeks with no issuance.
        return [[None if np.isnan(v) else v for v in row] for row in arr]

    results = {
        "labels": brackets_labels,
        "x": [d.strftime("%Y-%m-%d") for d in week_dates],
        "debt": [sampled[i].tolist() for i in range(len(brackets))],
        "interest_cost": [sampled_interest[i].tolist() for i in range(len(brackets))],
        "issue_rate": jsonable(issue_rate),
        "fed_rate": fed_rate,
    }

    with open(OUTPUT, "w") as f:
        json.dump(results, f)

    total = sampled[:, -1].sum()
    total_interest = sampled_interest[:, -1].sum()
    print(f"Wrote {OUTPUT}: {len(week_dates)} weeks, {len(brackets_labels)} brackets")
    print(f"Latest week {week_dates[-1]:%Y-%m-%d}: ${total / 1e12:.4} trillion total")
    print(f"Latest week {week_dates[-1]:%Y-%m-%d}: ${total_interest / 1e9:.4} billion/year interest")


if __name__ == "__main__":
    main()
