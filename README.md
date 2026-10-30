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

After a successful download, `data/download_metadata.json` records the download
date for compilation. Download and compilation dates use US Eastern time
(`America/New_York`, EST/EDT).

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

The `latest` object contains the download-day `date`, total `debt` (dollars),
total `interest_cost` (dollars/year, including inflation-adjusted TIPS), and
`fed_rate` (the latest available rate on or before that date). The web app uses
this daily snapshot for its “as of” headings while the graphs stay weekly.
For older caches without download metadata, compilation uses the latest auction
record date.

### 4. Launch the web server

The web app lives in `web/`. Install its dependencies and start the local dev
server:

```sh
cd web
npm install
npm run dev
```

This serves the app (consuming `results.json`) at the URL Vite prints
(by default <http://localhost:5173>).

## License

[MIT](LICENSE)
