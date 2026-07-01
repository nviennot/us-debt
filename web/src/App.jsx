import { useEffect, useRef, useSyncExternalStore } from "react";
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
import Methodology from "./Methodology.jsx";
import ChatFooter from "./ChatFooter.jsx";
export const COLORS = ["#2563eb", "#06b6d4", "#10b981", "#7dc24a"];

// Federal funds rate is an overlay reference line, distinct from the brackets.
const FED_LABEL = "Fed funds rate";
const FED_COLOR = "#e5e7eb";

// Populated at runtime by loadResults() before the app renders, so results.json
// is fetched as a separate static asset rather than bundled into the JS.
// Cached on window so it survives HMR re-evaluation of this module (which would
// otherwise reset the binding to undefined and blank the page on hot reload).
let results = import.meta.env.DEV ? window.__results : undefined;

export async function loadResults() {
  results = await fetch("/results.json").then((r) => r.json());
  if (import.meta.env.DEV) window.__results = results;
}

export function getResults() {
  return results;
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

// Turn a chart title into a URL-safe anchor id, e.g. "Annual US debt interest
// cost" -> "annual-us-debt-interest-cost".
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const LinkIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

// Chart heading with a permalink anchor. The link icon is revealed on hover
// and copies/points to #<slug> so a specific chart can be linked to directly.
export function ChartTitle({ title }) {
  const id = slugify(title);
  return (
    <div className="chart-title" id={id}>
      {title}
      <a className="chart-permalink" href={`#${id}`} aria-label={`Permalink to ${title}`}>
        <LinkIcon />
      </a>
    </div>
  );
}

// Track whether the viewport is narrow (mobile), re-rendering on resize.
const mobileQuery = window.matchMedia("(max-width: 700px)");
function subscribeMobile(cb) {
  mobileQuery.addEventListener("change", cb);
  return () => mobileQuery.removeEventListener("change", cb);
}
export function useIsMobile() {
  return useSyncExternalStore(subscribeMobile, () => mobileQuery.matches);
}

// Make horizontal scrubbing exclusive: once a touch gesture is judged to be
// horizontal, lock out vertical page scroll for the rest of that gesture by
// preventing the (non-passive) touchmove default. Vertical-first gestures are
// left to scroll the page, and are stopped from reaching Recharts so they
// don't activate the tooltip. React's onTouchMove is passive and cannot
// preventDefault, so the listener is attached imperatively via a ref.
// Hide every chart's tooltip. Recharts wires tooltip-hide to React's
// onMouseLeave, which it synthesizes from a native mouseout whose relatedTarget
// lies outside the chart; document.body satisfies that. Dispatch one per chart.
function hideAllTooltips() {
  document.querySelectorAll(".recharts-wrapper").forEach((w) =>
    w.dispatchEvent(
      new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })
    )
  );
}

export function useHorizontalScrubLock() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let axis = null; // null | "x" | "y", decided once per gesture

    const onStart = (e) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      axis = null;
    };
    const onMove = (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (axis === null) {
        // Wait for a small threshold before committing to an axis.
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        // A tooltip may already be showing from the initial touch. Clear it as
        // the scroll begins (the global scroll listener also covers scrolls
        // that start outside any chart).
        if (axis === "y") hideAllTooltips();
      }
      if (axis === "x") {
        // Horizontal scrub: suppress vertical page scroll so it's exclusive.
        // Let the event reach Recharts so it moves the tooltip.
        if (e.cancelable) e.preventDefault();
      } else {
        // Vertical page scroll: stop the event from reaching Recharts'
        // (root-delegated) touchmove handler so the tooltip never activates
        // while scrolling. Capture phase runs before React's root listener.
        e.stopPropagation();
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false, capture: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove, { capture: true });
    };
  }, []);
  return ref;
}

// Dismiss any open chart tooltip whenever the page scrolls, including scrolls
// that begin outside a chart (the per-chart handler only sees its own touches).
function useDismissTooltipsOnScroll() {
  useEffect(() => {
    const onScroll = () => hideAllTooltips();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
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
  const scrubRef = useHorizontalScrubLock();
  return (
    <div className="chart-panel">
      <ChartTitle title={title} />
      {subtitle && <div className="chart-subtitle">{subtitle}</div>}
      <div className="chart-area" ref={scrubRef}>
        <Legend />
        <ResponsiveContainer width="100%" height={isMobile ? 300 : 420}>
          <AreaChart data={data} margin={isMobile ? { top: 10, right: 4, left: 4, bottom: 0 } : { top: 10, right: 8, left: 34, bottom: 0 }}>
            <CartesianGrid stroke="#2a2f3a" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={(date) => (isMobile && (fmtYear(date) === "2000" || fmtYear(date) === "2001") ? "" : fmtYear(date))}
              ticks={yearTicks(isMobile ? 2 : 1)}
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
              interval={0}
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
  const scrubRef = useHorizontalScrubLock();
  return (
    <div className="chart-panel rate-panel">
      <ChartTitle title={title} />
      {subtitle && <div className="chart-subtitle">{subtitle}</div>}
      <div className="chart-area" ref={scrubRef}>
        <ResponsiveContainer width="100%" height={isMobile ? 300 : 420}>
          <LineChart data={data} margin={isMobile ? { top: 10, right: 4, left: 4, bottom: 0 } : { top: 10, right: 8, left: 34, bottom: 0 }}>
            <CartesianGrid stroke="#2a2f3a" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={(date) => (isMobile && (fmtYear(date) === "2000" || fmtYear(date) === "2001") ? "" : fmtYear(date))}
              ticks={yearTicks(isMobile ? 2 : 1)}
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
              allowDataOverflow
              stroke="#9aa3b2"
              width={56}
              interval={0}
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
const rateTicks = Array.from({ length: 12 }, (_, i) => i * 0.5); // 0..5.5% by 0.5%

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

function App() {
  useDismissTooltipsOnScroll();
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
      <p className="compiled-note">
        Based on {results.num_auctions.toLocaleString()} Treasury auction results<br/>
      </p>
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
        caption={<>Observation: <b style={{ color: '#e55' }}>The interest cost has tripled between 2022 and 2025</b><br />Source: {TREASURY_SOURCE} · {SOURCE_CODE}</>}
      />

      <LineRateChart
        title="Interest rate at issuance vs. fed funds rate"
        subtitle={<>as of {latestDate} fed funds rate is <b className="subtitle-value-white">{results.fed_rate[results.fed_rate.length - 1].toFixed(2)}%</b></>}
        data={issueRateData}
        yTicks={rateTicks}
        yDomain={[0, 5.5]}
        caption={<>Sources: {TREASURY_SOURCE} and {FRED_SOURCE} · {SOURCE_CODE}</>}
      />

      <Methodology />

      <ChatFooter />
    </div>
  );
}

export default App;
