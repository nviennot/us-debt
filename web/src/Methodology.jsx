// Collapsible "How this is made" section, mirroring the intro of debt.ipynb.
// Collapsed by default.
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
  Label,
  ResponsiveContainer,
} from "recharts";
import {
  getResults,
  COLORS,
  ChartTitle,
  useIsMobile,
  useHorizontalScrubLock,
} from "./App.jsx";

// Histogram of bond terms (in years) across all auctions, mirroring the
// "Term breakdown" histogram in debt.ipynb. Each bar is colored by the term
// bracket it falls into, and vertical lines mark the bracket boundaries used
// to classify bonds throughout the rest of the site.
function TermHistogram() {
  const results = getResults();
  const isMobile = useIsMobile();
  const scrubRef = useHorizontalScrubLock();
  const { counts, edges, brackets } = results.term_hist;

  // Bracket index of a term (in years), matching compile.py's searchsorted.
  const bracketOf = (years) => {
    for (let b = 0; b < brackets.length; b++) {
      if (years <= brackets[b]) return b;
    }
    return brackets.length - 1;
  };

  const data = counts.map((count, i) => {
    const mid = (edges[i] + edges[i + 1]) / 2;
    return { term: mid, count, bracket: bracketOf(mid) };
  });

  return (
    <div className="chart-panel">
      <ChartTitle title="Distribution of bond terms" />
      <div className="chart-area" ref={scrubRef}>
        <ResponsiveContainer width="100%" height={isMobile ? 180 : 240}>
          <BarChart
            data={data}
            margin={isMobile ? { top: 10, right: 4, left: 4, bottom: 0 } : { top: 10, right: 8, left: 34, bottom: 0 }}
          >
            <CartesianGrid stroke="#2a2f3a" strokeDasharray="3 3" />
            <XAxis
              dataKey="term"
              type="number"
              domain={[0, 31]}
              ticks={[1, 5, 10, 15, 20, 25, 30]}
              tickFormatter={(v) => `${v}y`}
              stroke="#9aa3b2"
            />
            <YAxis
              orientation="right"
              domain={[0, 800]}
              allowDataOverflow
              stroke="#9aa3b2"
              width={56}
            >
              <Label
                value="Number of bonds"
                angle={-90}
                position="insideRight"
                style={{ fill: "#9aa3b2", textAnchor: "middle" }}
              />
            </YAxis>
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.05)" }}
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="tooltip">
                    <div className="tooltip-date">
                      <span className="swatch" style={{ background: COLORS[d.bracket] }} />
                      {results.labels[d.bracket]}
                    </div>
                    <div className="tooltip-row">
                      <span className="tooltip-label">{d.term.toFixed(1)} years</span>
                      <span className="tooltip-value">{d.count}</span>
                    </div>
                  </div>
                );
              }}
              wrapperStyle={{ zIndex: 2 }}
            />
            {brackets.slice(0, -1).map((edge) => (
              <ReferenceLine key={edge} x={edge} stroke="#e5e7eb" strokeDasharray="4 4" />
            ))}
            <Bar dataKey="count" isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={COLORS[d.bracket]} fillOpacity={0.7} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <hr className="chart-divider" />
      <div className="chart-caption">
        Auctions cluster around standard terms (bills up to a year, then 2, 3, 5, 7, 10, 20, and
        30-year securities).  The dashed lines mark the boundaries we use to bin
        each bond into one of the four brackets.
        </div>
    </div>
  );
}

export default function Methodology() {
  return (
    <details className="methodology">
      <summary>Chart methodology &amp; data sources </summary>
      <div className="methodology-body">
        <h3>Auction results</h3>
        <p>The US Treasury issues debt by selling bills, notes, and bonds at
          auctions. The results are published{" "}
          <a href="https://treasurydirect.gov/auctions/announcements-data-results/announcement-results-press-releases/auction-results" target="_blank" rel="noreferrer">here</a>.
          Opening the "Competitive Results PDF" for a given security shows
          something like this:
        </p>
        <img
          className="methodology-image"
          src="/auction-results-example.png"
          alt="Example Treasury auction competitive results"
        />
          <div style={{ textAlign: "center" }}>
            <a href="https://treasurydirect.gov/instit/annceresult/press/preanre/2025/R_20250416_2.pdf" target="_blank" rel="noreferrer">
              https://treasurydirect.gov/instit/annceresult/press/preanre/2025/R_20250416_2.pdf
            </a>
          </div>

        <p>Each auction result includes several important details:</p>
        <ul>
          <li>
            The <i>term</i>: 19-Year 10-Month. It's fractional because this is
            the same batch of bonds reopened and sold 2 months after the
            original issue. This distinction matters for how we classify bonds
            by term.
          </li>
          <li>
            <i>Issue Date</i>: the date the money is loaned to the Treasury.
          </li>
          <li>
            <i>Maturity Date</i>: the date the money is repaid. We use the gap
            between this and the <i>Issue Date</i> as the effective term.
          </li>
          <li>
            The <i>interest rate</i>: 4.75%.
          </li>
          <li>
            The <i>price</i> of a $100 bond, here $99.22, set by the auction
            participants. The bonds are sold through a{" "}
            <a href="https://www.investopedia.com/terms/d/dutchauction.asp" target="_blank" rel="noreferrer">
              Dutch auction
            </a>
            . Paying $99.22 for a bond that pays 4.75% on its $100 face value
            and repays the full $100 at maturity means the buyer earns slightly
            more than the coupon: the $0.78 discount is extra return on top of
            the interest, so the effective <i>high yield</i> is 4.810%, a bit
            above the 4.75% coupon rate.
          </li>
          <li>
            In the <i>Accepted</i> column, the <i>Total</i> is the amount of
            debt actually sold. This is the number that matters for us.
          </li>
          <li>
            The <i>Tendered</i> column shows all the bids submitted, which we
            don't track. Note that the <i>Noncompetitive</i> and <i>SOMA</i>{" "}
            line items are filled in full (Tendered == Accepted).
          </li>
        </ul>

        <p>
          The full auction results are also available programmatically at{" "}
          <a href="https://fiscaldata.treasury.gov/datasets/treasury-securities-auctions-data/treasury-securities-auctions-data" target="_blank" rel="noreferrer" >
            fiscaldata.treasury.gov
          </a>.

          We use this API to download every auction result.
          (see{" "}
          <a href="https://github.com/nviennot/us-debt/blob/main/download.py" target="_blank" rel="noreferrer">download.py</a> creating {" "}
          <a href="https://github.com/nviennot/us-debt/tree/main/data" target="_blank" rel="noreferrer">./data</a>)
        </p>

        <h3>Bond terms</h3>

        <p>
          The following show the distribution of bond terms (the time from issue to
          maturity)
        </p>

        <TermHistogram />

        <p>
          Based on this distribution, we bin securities into four term categories:
        </p>
        <ul>
          <li>
            <b>≤ 6 months</b>: short-term Treasury bills (4, 8, 13, and 26-week
            bills).
          </li>
          <li>
            <b>1 - 3 years</b>: 52-week bills and 2 and 3-year notes.
          </li>
          <li>
            <b>4 - 7 years</b>: 4, 5, and 7-year notes.
          </li>
          <li>
            <b>10 - 30 years</b>: 10-year notes and 20 and 30-year bonds.
          </li>
        </ul>

        <h3>Chart 1: The aggregated debt</h3>
        <p>
          To turn individual auctions into the debt-over-time chart, we treat
          each security's <i>Total Accepted</i> amount as outstanding on every
          day between its <i>Issue Date</i> and <i>Maturity Date</i>. For a given
          day, the total debt is simply the sum of every security whose life span
          covers that day, split into the four term brackets described above.
        </p>

        <h3>Chart 2: The cost of the interest on the debt</h3>
        <p>
          The interest cost is computed the same way as above, but instead of adding the
          face amount we add <code>amount × rate</code> (the annual coupon), where{" "}
          <code>rate</code> is the security's interest rate for notes and bonds,
          or its high investment rate for bills. TIPS are handled separately
          because their coupon is paid on an inflation-adjusted principal, so we
          scale their interest by the Treasury reference-CPI index ratio on each
          date.
        </p>

        <h3>Chart 3: Interest rate at issuance</h3>
        <p>
          The third chart shows the interest rate the Treasury pays on newly
          issued debt, per term bracket. Since a week can issue securities of
          different sizes, we compute an <b>amount-weighted average</b> of their
          rates, so a $50B issue counts five times as much as a $10B one:
        </p>
        <p style={{ textAlign: "center" }}>
          <code>rate = Σ(amountᵢ × rateᵢ) / Σ(amountᵢ)</code>
        </p>
        <p>
          A single week's issuance is noisy, since each week mixes securities of
          different maturities and reopenings that carry old coupons. To smooth
          this out, the weighted average above is taken over every security
          issued in a trailing window, not just the current week. The window
          length is per bracket, because short-term bills are auctioned very
          often while 20 and 30-year bonds are issued rarely; a longer window fills
          the gaps between those infrequent auctions:
        </p>
        <ul>
          <li>
            <b>≤ 6 months</b>: 8-week window.
          </li>
          <li>
            <b>1 - 3 years</b>: 13-week window.
          </li>
          <li>
            <b>4 - 7 years</b>: 21-week window.
          </li>
          <li>
            <b>10 - 30 years</b>: 26-week window.
          </li>
        </ul>
        <p>
          We overlay the{" "}
          <a href="https://fred.stlouisfed.org/series/DFF" target="_blank" rel="noreferrer">
            federal funds rate
          </a>{" "}
          for comparison.
        </p>

        <h3>Source code</h3>
        <p>All of the code and data used to produce these results are available on GitHub:<br/>
          <a href="https://github.com/nviennot/us-debt/blob/main/download.py" target="_blank" rel="noreferrer">download.py</a>,{" "}
          <a href="https://github.com/nviennot/us-debt/tree/main/data" target="_blank" rel="noreferrer">data/</a>,{" "}
          <a href="https://github.com/nviennot/us-debt/blob/main/compile.py" target="_blank" rel="noreferrer">compile.py</a>,{" "}
          <a href="https://github.com/nviennot/us-debt/blob/main/results.json" target="_blank" rel="noreferrer">results.json</a>.
        </p>
      </div>
    </details>
  );
}
