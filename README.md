# US Debt

Weekly US Treasury debt and interest cost, broken down by bond term.

The data pipeline is two steps: `download.py` fetches the raw source data into
`data/`, and `compile.py` processes it into `results.json` (consumed by the web
app in `web/`).

## Generating the data

### 1. Install dependencies

Requires [uv](https://docs.astral.sh/uv/). Install the dependencies (declared in
`pyproject.toml`) into a virtual environment:

```sh
uv venv
uv sync
```

This reads `pyproject.toml` / `uv.lock` and pulls in `numpy`, `pandas`, and
`truststore`. Prefix the commands below with `uv run` to use this environment
(e.g. `uv run python download.py`).

### 2. Download the raw data

```sh
uv run python download.py
```

This fetches three datasets into `data/`:

- **Treasury auction results** — partitioned by year into `data/auctions_YYYY.json`
  (from the Treasury Fiscal Data API, starting in 1979).
- **CPI-U history** — `data/cpi_u.json`, used for TIPS inflation indexing
  (from the BLS API).
- **Federal funds effective rate** — `data/fed_funds.json` (FRED series `DFF`).

### 3. Compile the results

```sh
uv run python compile.py
```

This reads everything in `data/` and writes `results.json`, a weekly time series
(starting in 2000) with, per term bracket:

- `debt` — debt outstanding (dollars)
- `interest_cost` — annual interest cost (dollars/year), with TIPS coupons adjusted
  for inflation
- `issue_rate` — amount-weighted coupon rate of that period's issuance (%)
- `fed_rate` — federal funds effective rate (%)
