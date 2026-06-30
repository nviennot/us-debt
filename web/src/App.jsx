import { useSyncExternalStore } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
const COLORS = ["#2563eb", "#06b6d4", "#10b981", "#7dc24a"];

// Federal funds rate is an overlay reference line, distinct from the brackets.
const FED_LABEL = "Fed funds rate";
const FED_COLOR = "#e5e7eb";

// Populated at runtime by loadResults() before the app renders, so results.json
// is fetched as a separate static asset rather than bundled into the JS.
let results;

export async function loadResults() {
  results = await fetch("/results.json").then((r) => r.json());
}

// Build one row per week: { date, <label0>: value, <label1>: value, ... }
// scaled from raw dollars into the chart's display unit.
function seriesData(yKey, scale) {
  return results.x.map((date, i) => {
    const row = { date };
    results.labels.forEach((label, b) => {
      const v = results[yKey][b][i];
      row[label] = v == null ? null : v / scale;
    });
    return row;
  });
}

const fmtYear = (date) => date.slice(0, 4);

// Track whether the viewport is narrow (mobile), re-rendering on resize.
const mobileQuery = window.matchMedia("(max-width: 700px)");
function subscribeMobile(cb) {
  mobileQuery.addEventListener("change", cb);
  return () => mobileQuery.removeEventListener("change", cb);
}
function useIsMobile() {
  return useSyncExternalStore(subscribeMobile, () => mobileQuery.matches);
}

// First sampled date of each year, used as explicit x-axis ticks.
// On mobile, thin to every `step`th year so labels don't crowd. Anchored
// from the end so the most recent year is always labeled.
function yearTicks(step = 1) {
  const firstOfYear = results.x.filter(
    (date, i) => i === 0 || date.slice(0, 4) !== results.x[i - 1].slice(0, 4)
  );
  const last = firstOfYear.length - 1;
  return firstOfYear.filter((_, i) => (last - i) % step === 0);
}

// Tooltip styled like the legend, in label order (top of stack first).
function makeTooltip(unit, decimals, showTotal = true, extras = []) {
  return function CustomTooltip({ active, payload, label }) {
    if (!active || !payload || !payload.length) return null;
    const total = payload
      .filter((p) => extras.every((e) => e.label !== p.dataKey))
      .reduce((sum, p) => sum + p.value, 0);
    return (
      <div className="tooltip">
        <div className="tooltip-date">{label}</div>
        {extras.map(({ label: name, color }) => {
          const item = payload.find((p) => p.dataKey === name);
          if (!item || item.value == null) return null;
          return (
            <div className="tooltip-row" key={name}>
              <span className="swatch" style={{ background: color }} />
              <span className="tooltip-label">{name}</span>
              <span className="tooltip-value">
                {unit === "%" ? "" : "$"}
                {item.value.toFixed(decimals)}
                {unit === "%" ? "%" : unit}
              </span>
            </div>
          );
        })}
        {extras.length > 0 && <div className="tooltip-divider" />}
        {results.labels.map((name, b) => {
          const item = payload.find((p) => p.dataKey === name);
          if (!item || item.value == null) return null;
          return (
            <div className="tooltip-row" key={name}>
              <span className="swatch" style={{ background: COLORS[b] }} />
              <span className="tooltip-label">{name}</span>
              <span className="tooltip-value">
                {unit === "%" ? "" : "$"}
                {item.value.toFixed(decimals)}
                {unit === "%" ? "%" : unit}
              </span>
            </div>
          );
        })}
        {showTotal && (
          <div className="tooltip-row tooltip-total">
            <span className="tooltip-label">Total</span>
            <span className="tooltip-value">
              ${total.toFixed(decimals)}
              {unit}
            </span>
          </div>
        )}
      </div>
    );
  };
}

function Legend({ extras = [] }) {
  return (
    <div className="chart-legend">
      {extras.map(({ label, color }) => (
        <span className="chart-legend-item" key={label}>
          <span className="swatch" style={{ background: color }} />
          {label}
        </span>
      ))}
      {extras.length > 0 && <div className="chart-legend-divider" />}
      <div className="chart-legend-title">Bond term</div>
      {results.labels.map((label, b) => (
        <span className="chart-legend-item" key={label}>
          <span className="swatch" style={{ background: COLORS[b] }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function StackedChart({ title, subtitle, caption, data, unit, decimals, yTicks, yDomain }) {
  const Tip = makeTooltip(unit, decimals);
  const isMobile = useIsMobile();
  return (
    <div className="chart-panel">
      <div className="chart-title">{title}</div>
      {subtitle && <div className="chart-subtitle">{subtitle}</div>}
      <div className="chart-area">
        <Legend />
        <ResponsiveContainer width="100%" height={420}>
          <AreaChart data={data} margin={isMobile ? { top: 10, right: 4, left: 4, bottom: 0 } : { top: 10, right: 8, left: 34, bottom: 0 }}>
            <CartesianGrid stroke="#2a2f3a" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtYear}
              ticks={yearTicks(isMobile ? 3 : 1)}
              interval={0}
              stroke="#9aa3b2"
              angle={-45}
              textAnchor="end"
              height={50}
            />
            <YAxis
              orientation="right"
              tickFormatter={(v) =>
                unit === "B" && v >= 1000
                  ? `$${(v / 1000).toFixed(0)}T`
                  : `$${v.toFixed(0)}${unit}`
              }
              ticks={yTicks}
              domain={yDomain}
              stroke="#9aa3b2"
              width={56}
            />
            <Tooltip content={<Tip />} wrapperStyle={{ zIndex: 2 }} />
            {results.labels
              .map((label, b) => ({ label, b }))
              .reverse()
              .map(({ label, b }) => (
                <Area
                  key={label}
                  type="monotone"
                  dataKey={label}
                  stackId="stack"
                  stroke={COLORS[b]}
                  fill={COLORS[b]}
                  fillOpacity={0.35}
                  isAnimationActive={false}
                />
              ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {caption && (
        <>
          <hr className="chart-divider" />
          <div className="chart-caption">{caption}</div>
        </>
      )}
    </div>
  );
}

function LineRateChart({ title, subtitle, caption, data, yTicks, yDomain }) {
  const extras = [{ label: FED_LABEL, color: FED_COLOR }];
  const Tip = makeTooltip("%", 2, false, extras);
  const isMobile = useIsMobile();
  return (
    <div className="chart-panel rate-panel">
      <div className="chart-title">{title}</div>
      {subtitle && <div className="chart-subtitle">{subtitle}</div>}
      <div className="chart-area">
        <Legend extras={extras} />
        <ResponsiveContainer width="100%" height={420}>
          <LineChart data={data} margin={isMobile ? { top: 10, right: 4, left: 4, bottom: 0 } : { top: 10, right: 8, left: 34, bottom: 0 }}>
            <CartesianGrid stroke="#2a2f3a" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtYear}
              ticks={yearTicks(isMobile ? 3 : 1)}
              interval={0}
              stroke="#9aa3b2"
              angle={-45}
              textAnchor="end"
              height={50}
            />
            <YAxis
              orientation="right"
              tickFormatter={(v) => `${v.toFixed(1)}%`}
              ticks={yTicks}
              domain={yDomain}
              stroke="#9aa3b2"
              width={56}
            />
            <Tooltip content={<Tip />} wrapperStyle={{ zIndex: 2 }} />
            <Line
              type="monotone"
              dataKey={FED_LABEL}
              stroke={FED_COLOR}
              strokeWidth={1}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            {results.labels.map((label, b) => (
              <Line
                key={label}
                type="monotone"
                dataKey={label}
                stroke={COLORS[b]}
                strokeOpacity={0.8}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {caption && (
        <>
          <hr className="chart-divider" />
          <div className="chart-caption">{caption}</div>
        </>
      )}
    </div>
  );
}

const debtTicks = Array.from({ length: 9 }, (_, i) => i * 4); // 0..32T
const interestTicks = Array.from({ length: 11 }, (_, i) => i * 100); // 0..1000B
const rateTicks = Array.from({ length: 15 }, (_, i) => i * 0.5); // 0..7% by 0.5%

// Sum of all bracket values in the most recent row, in display units.
function latestTotal(data) {
  const row = data[data.length - 1];
  return results.labels.reduce((sum, label) => sum + (row[label] ?? 0), 0);
}

const TREASURY_SOURCE = (
  <a
    href="https://fiscaldata.treasury.gov/datasets/treasury-securities-auctions-data/treasury-securities-auctions-data"
    target="_blank"
    rel="noreferrer"
  >
    US Treasury auction results
  </a>
);

const FRED_SOURCE = (
  <a
    href="https://fred.stlouisfed.org/series/DFF"
    target="_blank"
    rel="noreferrer"
  >
    federal funds effective rate (FRED)
  </a>
);

const SOURCE_CODE = (
  <a href="https://github.com/nviennot/us-debt/" target="_blank" rel="noreferrer">
    Source code on GitHub
  </a>
);

const LinkedInIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.8 0 0 .78 0 1.74v20.52C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.74V1.74C24 .78 23.2 0 22.22 0z" />
  </svg>
);

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .32.21.7.82.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
  </svg>
);

const TelegramIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M23.95 4.57l-3.62 17.09c-.27 1.2-.99 1.5-2 .93l-5.52-4.07-2.66 2.56c-.3.3-.55.55-1.12.55l.4-5.65L19.4 6.18c.45-.4-.1-.62-.7-.22L6.4 13.7.78 11.94c-1.22-.38-1.24-1.22.26-1.8L22.37 2.8c1.02-.38 1.9.23 1.58 1.77z" />
  </svg>
);

function App() {
  const debtData = seriesData("debt", 1e12); // trillions
  const interestData = seriesData("interest_cost", 1e9); // billions/year
  const issueRateData = seriesData("issue_rate", 1).map((row, i) => ({
    ...row,
    [FED_LABEL]: results.fed_rate[i],
  })); // percent, plus the fed funds rate overlay

  // Most recent date in the dataset.
  const latestDate = results.x[results.x.length - 1];

  return (
    <div className="container">
      <header>
        <h1>US Debt Watch</h1>
      </header>
      <StackedChart
        title="Marketable US Treasury debt"
        subtitle={<>as of {latestDate}: <b className="subtitle-value-white">${latestTotal(debtData).toFixed(2)}T</b></>}
        data={debtData}
        unit="T"
        decimals={2}
        yTicks={debtTicks}
        yDomain={[0, 32]}
        caption={<>Marketable debt is ~98% of US debt held by the public<br />Source: {TREASURY_SOURCE} · {SOURCE_CODE}</>}
      />

      <StackedChart
        title="Annual US debt interest cost"
        subtitle={<>as of {latestDate}: <b className="subtitle-value-white">${latestTotal(interestData).toFixed(0)}B</b></>}
        data={interestData}
        unit="B"
        decimals={1}
        yTicks={interestTicks}
        yDomain={[0, 1000]}
        caption={<>Source: {TREASURY_SOURCE} · {SOURCE_CODE}</>}
      />

      <LineRateChart
        title="Interest rate at issuance vs. fed funds rate"
        subtitle={<>as of {latestDate} fed funds rate is <b className="subtitle-value-white">{results.fed_rate[results.fed_rate.length - 1].toFixed(2)}%</b></>}
        data={issueRateData}
        yTicks={rateTicks}
        yDomain={[0, 7]}
        caption={<>Sources: {TREASURY_SOURCE} and {FRED_SOURCE} · {SOURCE_CODE}</>}
      />

      <footer className="site-footer">
        <span>Made by Nicolas Viennot</span>
        <span className="footer-links">
          <a href="https://www.linkedin.com/in/nviennot" target="_blank" rel="noreferrer" aria-label="LinkedIn"><LinkedInIcon /></a>
          <a href="https://github.com/nviennot" target="_blank" rel="noreferrer" aria-label="GitHub"><GitHubIcon /></a>
          <a href="https://t.me/nviennot" target="_blank" rel="noreferrer" aria-label="Telegram"><TelegramIcon /></a>
        </span>
      </footer>
    </div>
  );
}

export default App;
