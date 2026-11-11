// Small dependency-free SVG charts, themed with tokens. Styles: src/styles/pages/progress.css.
import { useState } from 'react';

export interface TrendDatum {
  /** Bar value (e.g. blunders in the game). */
  bar: number;
  /** Line value (e.g. rolling accuracy, 0-100). */
  line: number;
  tone: 'good' | 'bad' | 'neutral';
  tip: string;
  href?: string;
}

/**
 * A line (rolling average, scale lo..hi) over per-item bars (a count, on its own scale).
 * `alt` is the text alternative; every point is focusable and shows its tip below the chart.
 */
export function TrendChart({ data, lo, hi, alt, onOpen }: { data: TrendDatum[]; lo: number; hi: number; alt: string; onOpen?: (href: string) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const W = 720;
  const H = 180;
  const padL = 34;
  const padR = 8;
  const top = 10;
  const base = H - 22;
  const step = (W - padL - padR) / Math.max(1, data.length);
  const x = (i: number) => padL + step * (i + 0.5);
  const y = (v: number) => top + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (base - top);
  const maxBar = Math.max(3, ...data.map((d) => d.bar));
  const barH = (v: number) => (v / maxBar) * (base - top) * 0.45;
  const barW = Math.min(18, step * 0.64);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.line).toFixed(1)}`).join(' ');
  const ticks = [lo, (lo + hi) / 2, hi];
  const cur = active === null ? null : data[active];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={alt} preserveAspectRatio="none">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="chart-tick">{Math.round(t)}</text>
          </g>
        ))}
        {data.map((d, i) => (
          <rect key={i} x={x(i) - barW / 2} width={barW} y={base - barH(d.bar)} height={barH(d.bar)} rx="2" className={`chart-bar${active === i ? ' on' : ''}`} />
        ))}
        <path d={path} className="chart-line" />
        {data.map((d, i) => (
          <g
            key={i}
            tabIndex={0}
            role={d.href ? 'link' : 'img'}
            aria-label={d.tip}
            className="chart-hit"
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            onClick={() => d.href && onOpen?.(d.href)}
            onKeyDown={(e) => e.key === 'Enter' && d.href && onOpen?.(d.href)}
          >
            <rect x={x(i) - step / 2} y={0} width={step} height={H} fill="transparent" />
            <circle cx={x(i)} cy={base + 11} r="3.5" className={`chart-dot ${d.tone}`} />
            {active === i && <circle cx={x(i)} cy={y(d.line)} r="4.5" className="chart-point" />}
          </g>
        ))}
      </svg>
      <figcaption className="chart-tip" aria-hidden>{cur ? cur.tip : ' '}</figcaption>
    </figure>
  );
}

/** A horizontal bar for a 0-100 value. */
export function ScoreBar({ value, tone = 'neutral' }: { value: number; tone?: 'good' | 'bad' | 'neutral' }) {
  return (
    <span className="scorebar" aria-hidden>
      <span className={tone} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </span>
  );
}
