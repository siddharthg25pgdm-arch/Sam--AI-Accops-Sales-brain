/** Server-rendered charts for the dashboard. No chart library and no client JS: SVG and CSS only.
 *
 *  Rules these follow (the dataviz skill): one accent hue for magnitude, the neutral mark for
 *  context; thin marks with a 4px rounded data-end and square baseline; 2px surface gap between
 *  stacked segments; solid hairline grid; text in ink tokens, never in the series colour; a legend
 *  only when there are two or more series; every chart has a table twin, so a hover tooltip never
 *  gates a value. Colours come from CSS variables in globals.css (.dash), which switch for dark mode. */
import { heatStep, LATENCY_BUCKETS } from "@/lib/metrics";

const nf = new Intl.NumberFormat("en-IN");
export const num = (n: number | null | undefined) => (n == null ? "–" : nf.format(n));
export const ms = (v: number | null | undefined) => (v == null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

/** Round up to 1, 2 or 5 x 10^k so axis ticks are clean numbers. */
function niceMax(v: number) {
  if (v <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2 || values.every(v => v === 0)) return <span className="spark-empty" aria-hidden="true" />;
  const w = 112, h = 32, pad = 5, max = Math.max(1, ...values), n = values.length;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (n - 1);
  const y = (v: number) => h - pad - (v / max) * (h - 2 * pad);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <path className="spark-area" d={`M${x(0)},${h - pad} L${pts.join(" L")} L${x(n - 1)},${h - pad} Z`} />
      <polyline className="spark-line" points={pts.join(" ")} />
      <circle className="spark-dot" cx={x(n - 1)} cy={y(values[n - 1])} r={4} />
    </svg>
  );
}

/** A single ratio against 100%. The track is a light step of the fill's own ramp. */
export function Meter({ pct, label }: { pct: number | null; label: string }) {
  if (pct == null) return null; // below MIN_N a bar would imply precision the fraction does not have
  return (
    <span className="meter" role="img" aria-label={`${label}: ${pct}%`}>
      <span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </span>
  );
}

const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** Questions per day, split answered / not answered. Part-to-whole per day, so a stacked column. */
export function DailyColumns({ days }: { days: { day: string; questions: number; answered: number }[] }) {
  const max = niceMax(Math.max(0, ...days.map(d => d.questions)));
  const every = Math.ceil(days.length / 6), last = days.length - 1;
  // Label the first day, the last day, and every k-th between - unless it would crowd the last one.
  const labelled = (i: number) => i === last || (i % every === 0 && last - i >= every / 2);
  const total = days.reduce((n, d) => n + d.questions, 0);
  return (
    <figure className="chart">
      <div className="legend" aria-hidden="true">
        <span><i className="sw sw-accent" />Answered</span>
        <span><i className="sw sw-neutral" />Not answered</span>
      </div>
      <div className="cols" role="img" aria-label={`Questions per day: ${total} in ${days.length} days, peak ${Math.max(0, ...days.map(d => d.questions))}.`}>
        <div className="cgrid" aria-hidden="true">
          {[max, max / 2, 0].map(t => <div key={t} className="gl"><span>{num(t)}</span></div>)}
        </div>
        <div className="bars-row" aria-hidden="true">
          {days.map(d => {
            const other = d.questions - d.answered;
            return (
              <div key={d.day} className="col tip" data-tip={`${dayLabel(d.day)} · ${d.questions} asked · ${d.answered} answered`}>
                <div className="stack" style={{ height: `${(d.questions / max) * 100}%` }}>
                  {other > 0 && <span className="seg-neutral" style={{ flexGrow: other }} />}
                  {d.answered > 0 && <span className="seg-accent" style={{ flexGrow: d.answered }} />}
                </div>
              </div>
            );
          })}
        </div>
        {total === 0 && <p className="chart-empty">No questions in this period.</p>}
      </div>
      <div className="xaxis" aria-hidden="true">
        {days.map((d, i) => <span key={d.day}>{labelled(i) ? dayLabel(d.day) : ""}</span>)}
      </div>
      <details className="twin">
        <summary>Show as table</summary>
        <table><thead><tr><th>Day</th><th className="r">Asked</th><th className="r">Answered</th></tr></thead>
          <tbody>{days.filter(d => d.questions).map(d => <tr key={d.day}><td>{dayLabel(d.day)}</td><td className="r">{d.questions}</td><td className="r">{d.answered}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}

/** Nominal categories by count: one colour for every bar (colour would only repeat the length). */
export function BarList({ rows, total, label, fold = 7 }: { rows: { key: string; n: number }[]; total?: number; label: string; fold?: number }) {
  if (!rows.length) return <p className="empty-inline">Nothing recorded.</p>;
  const shown = rows.slice(0, fold);
  const rest = rows.slice(fold).reduce((n, r) => n + r.n, 0);
  if (rest) shown.push({ key: "Other", n: rest });
  const max = Math.max(1, ...shown.map(r => r.n));
  const sum = total ?? rows.reduce((n, r) => n + r.n, 0);
  return (
    <ul className="barlist" aria-label={label}>
      {shown.map(r => (
        <li key={r.key}>
          <span className="bl-label" title={r.key}>{r.key}</span>
          <span className="bl-track" aria-hidden="true"><span style={{ width: `${(r.n / max) * 100}%` }} /></span>
          <span className="bl-val">{num(r.n)}<small>{sum ? ` ${Math.round((r.n / sum) * 100)}%` : ""}</small></span>
        </li>
      ))}
    </ul>
  );
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Hour of day x weekday. Magnitude on a grid, so a single-hue sequential ramp; zero is its own
 *  neutral so "nobody" never reads as "a few". */
export function Heatmap({ cells }: { cells: { dow: number; hour: number; n: number }[] }) {
  const at = new Map(cells.map(c => [`${c.dow}-${c.hour}`, c.n]));
  const max = Math.max(0, ...cells.map(c => c.n));
  const busiest = [...cells].sort((a, b) => b.n - a.n)[0];
  return (
    <figure className="chart">
      <div className="heat" role="img" aria-label={busiest ? `Busiest: ${DOW[busiest.dow - 1]} ${String(busiest.hour).padStart(2, "0")}:00 with ${busiest.n} questions.` : "No questions."}>
        {DOW.map((d, i) => (
          <div key={d} className="heat-row" aria-hidden="true">
            <span className="heat-lab">{d}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const n = at.get(`${i + 1}-${h}`) ?? 0;
              return <span key={h} className={`hc h${heatStep(n, max)} tip`} data-tip={`${d} ${String(h).padStart(2, "0")}:00 · ${n}`} />;
            })}
          </div>
        ))}
        <div className="heat-row heat-hours" aria-hidden="true">
          <span className="heat-lab" />
          {Array.from({ length: 24 }, (_, h) => <span key={h}>{h % 6 === 0 ? `${String(h).padStart(2, "0")}` : ""}</span>)}
        </div>
      </div>
      <div className="heat-key" aria-hidden="true">
        <span>None</span><i className="hc h0" /><span className="gap-s" />
        <span>Fewer</span>{[1, 2, 3, 4].map(s => <i key={s} className={`hc h${s}`} />)}<span>More{max ? ` (${max})` : ""}</span>
      </div>
      <details className="twin">
        <summary>Show as table</summary>
        <table><thead><tr><th>When</th><th className="r">Questions</th></tr></thead>
          <tbody>{[...cells].sort((a, b) => b.n - a.n).map(c => <tr key={`${c.dow}-${c.hour}`}><td>{DOW[c.dow - 1]} {String(c.hour).padStart(2, "0")}:00</td><td className="r">{c.n}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}

/** Response-time distribution in doubling buckets: the shape shows whether p95 is one outlier or a
 *  slow tail. Six columns, so each carries its value on the cap. */
export function Histogram({ buckets }: { buckets: { bucket: number; n: number }[] }) {
  const counts = LATENCY_BUCKETS.map((_, i) => buckets.find(b => b.bucket === i)?.n ?? 0);
  const max = Math.max(1, ...counts);
  return (
    <figure className="chart">
      <div className="hist" role="img" aria-label={`Response times: ${LATENCY_BUCKETS.map((l, i) => `${l} ${counts[i]}`).join(", ")}.`}>
        {counts.map((n, i) => (
          <div key={i} className="hcol" aria-hidden="true">
            <span className="hval">{n || ""}</span>
            <span className="hbar" style={{ height: `${(n / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="xaxis even" aria-hidden="true">{LATENCY_BUCKETS.map(l => <span key={l}>{l}</span>)}</div>
    </figure>
  );
}
