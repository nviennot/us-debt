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
  (from the Treasury Fiscal Data API, starting in 1979, supplemented with recent
  TreasuryDirect results).
- **CPI-U history** — `data/cpi_u.json`, used for TIPS inflation indexing
  (from the BLS API).
- **Federal funds effective rate** — `data/fed_funds.json` (FRED series `DFF`).

After a successful download, `data/download_metadata.json` records the download
date for compilation. Download and compilation dates use US Eastern time
(`America/New_York`, EST/EDT).

The current and previous auction years are refreshed each run; older years are
cached. Use `uv run python download.py --refresh-all` to fetch all years again.

#### Getting current auction results

Fiscal Data can respond successfully while its auction results are stale. On
November 10, 2026, it still had missing accepted amounts for issues from October
22 onward. TreasuryDirect's own search endpoint supplied those results:

```text
https://www.treasurydirect.gov/TA_WS/securities/search?format=json&issueDate=2026-01-01,2026-12-31
```

No API key is needed. `download.py` queries this endpoint for the current and
previous issue years and fills missing Fiscal Data fields, adding absent auctions.
It matches on **CUSIP + issue date** because a security can be reopened multiple
times. `grandTotalParAwarded` maps to `total_accepted` (including SOMA awards),
`interestRate` to `int_rate`, `investmentRate` to `high_investment_rate`, and
`referenceCpiOnOriginalDatedDate` to the TIPS base CPI. Future announcements keep
their missing amounts until results are published.

Use the `issueDate` range filter: `auctionDate` is not the search API's auction
date field. The website's `/securities/auctioned` endpoint is a limited list of
unmatured securities, so it is insufficient for rebuilding historical issuance.

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

The `latest` object contains the data-supported `date`, total `debt` (dollars),
total `interest_cost` (dollars/year, including inflation-adjusted TIPS), and
`fed_rate` (the latest available rate on or before that date). The web app uses
this daily snapshot for its “as of” headings while the graphs stay weekly.
Reporting is capped at the earlier of the download date and the latest issuance
date with a known accepted amount. If a still-outstanding auction has a missing
amount, reporting stops at a known issuance date before that gap. This prevents
stale or incomplete auction results from showing maturities as a false debt
decline. Historical missing amounts on already-matured securities do not block
current reporting. For older caches without download metadata, the latest auction
record date supplies the download-date limit.

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
