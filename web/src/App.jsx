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
const COLORS = ["#2563eb", "#06b6d4", "#10b981", "#a3c93a"];

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

// First sampled date of each year, used as explicit x-axis ticks (one per year).
function yearTicks() {
  return results.x.filter(
    (date, i) => i === 0 || date.slice(0, 4) !== results.x[i - 1].slice(0, 4)
  );
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

function StackedChart({ title, subtitle, data, unit, decimals, yTicks, yDomain }) {
  const Tip = makeTooltip(unit, decimals);
  return (
    <div className="chart-panel">
      <div className="chart-title">{title}</div>
      {subtitle && <div className="chart-subtitle">{subtitle}</div>}
      <div className="chart-area">
        <Legend />
        <ResponsiveContainer width="100%" height={420}>
          <AreaChart data={data} margin={{ top: 10, right: 8, left: 34, bottom: 0 }}>
            <CartesianGrid stroke="#2a2f3a" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtYear}
              ticks={yearTicks()}
              interval={0}
              stroke="#9aa3b2"
              angle={-45}
              textAnchor="end"
              height={50}
            />
            <YAxis
              orientation="right"
              tickFormatter={(v) => `$${v.toFixed(0)}${unit}`}
              ticks={yTicks}
              domain={yDomain}
              stroke="#9aa3b2"
              width={56}
            />
            <Tooltip content={<Tip />} />
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
    </div>
  );
}

function LineRateChart({ title, subtitle, data, yTicks, yDomain }) {
  const extras = [{ label: FED_LABEL, color: FED_COLOR }];
  const Tip = makeTooltip("%", 2, false, extras);
  return (
    <div className="chart-panel rate-panel">
      <div className="chart-title">{title}</div>
      {subtitle && <div className="chart-subtitle">{subtitle}</div>}
      <div className="chart-area">
        <Legend extras={extras} />
        <ResponsiveContainer width="100%" height={420}>
          <LineChart data={data} margin={{ top: 10, right: 8, left: 34, bottom: 0 }}>
            <CartesianGrid stroke="#2a2f3a" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtYear}
              ticks={yearTicks()}
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
            <Tooltip content={<Tip />} />
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
      <StackedChart
        title="Marketable US Treasury debt"
        subtitle={<>as of {latestDate}: <b className="subtitle-value-white">${latestTotal(debtData).toFixed(2)}T</b></>}
        data={debtData}
        unit="T"
        decimals={2}
        yTicks={debtTicks}
        yDomain={[0, 32]}
      />

      <StackedChart
        title="Annual US debt interest cost"
        subtitle={<>as of {latestDate}: <b className="subtitle-value-white">${latestTotal(interestData).toFixed(0)}B</b></>}
        data={interestData}
        unit="B"
        decimals={1}
        yTicks={interestTicks}
        yDomain={[0, 1000]}
      />

      <LineRateChart
        title="Interest rate at issuance vs. fed funds rate"
        subtitle={<>as of {latestDate} fed funds rate is <b className="subtitle-value-white">{results.fed_rate[results.fed_rate.length - 1].toFixed(2)}%</b></>}
        data={issueRateData}
        yTicks={rateTicks}
        yDomain={[0, 7]}
      />

      <footer>
        Source: US Treasury auction results
      </footer>
    </div>
  );
}

export default App;
