// Shared UI primitives. Styles live in src/styles/components.css; see DESIGN_SYSTEM.md.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { copy } from '../copy';
import { liveCards, statusOf, type CardRow, type LineStatus } from '../srs/db';
import type { Repertoire } from '../repertoire';
import { ArrowLeftIcon } from './icons';

export function useCards(): Map<string, CardRow> | undefined {
  return useLiveQuery(async () => new Map((await liveCards()).map((c) => [c.lineId, c])), []);
}

export function StatusBadge({ status }: { status: LineStatus }) {
  return <span className={`badge ${status}`}>{copy.status[status]}</span>;
}

/** Counts of a repertoire's lines by drill status. */
export function lineCounts(rep: Repertoire, cards?: Map<string, CardRow>) {
  const counts = { new: 0, learning: 0, due: 0, known: 0 } satisfies Record<LineStatus, number>;
  for (const l of rep.lines) counts[statusOf(cards?.get(l.id))]++;
  const total = rep.lines.length;
  return { ...counts, total, started: total - counts.new };
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="back">
      <ArrowLeftIcon />
      {children}
    </Link>
  );
}

/** Top of a page: optional back link and kicker, the title, a lead line, and actions on the right. */
export function PageHeader({
  title,
  kicker,
  lead,
  actions,
  back,
}: {
  title: ReactNode;
  kicker?: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: ReactNode };
}) {
  return (
    <>
      {back && <BackLink to={back.to}>{back.label}</BackLink>}
      <header className="page-header">
        <div className="grow">
          {kicker && <p className="kicker">{kicker}</p>}
          <h1>{title}</h1>
          {lead && <p className="lead">{lead}</p>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </header>
    </>
  );
}

/** A titled block separated from its neighbours by a hairline, not a box. */
export function Section({
  title,
  note,
  action,
  children,
  className = '',
  id,
}: {
  title: ReactNode;
  note?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`section ${className}`} id={id}>
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          {note && <p className="muted">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  actions,
  center,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={`empty-state${center ? ' center' : ''}`}>
      {icon && <div className="empty-art" aria-hidden>{icon}</div>}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Stat({ value, label, unit, delta }: { value: ReactNode; label: ReactNode; unit?: string; delta?: { text: string; dir: 'up' | 'down' | 'flat' } }) {
  return (
    <div className="stat">
      <span className="stat-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      <span className="stat-label">{label}</span>
      {delta && <span className={`stat-delta ${delta.dir}`}>{delta.text}</span>}
    </div>
  );
}

/** One choice of a few. Renders a radiogroup-style row of buttons. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  block,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: ReactNode }[];
  label: string;
  block?: boolean;
}) {
  return (
    <div className={`seg${block ? ' block' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

export function Callout({
  tone = 'neutral',
  icon,
  children,
  actions,
  role = 'status',
}: {
  tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'brand';
  icon?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  role?: 'status' | 'alert' | 'note';
}) {
  return (
    <div className={`callout ${tone === 'neutral' ? '' : tone}`} role={role}>
      {icon}
      <div className="callout-body">{children}</div>
      {actions && <div className="callout-actions">{actions}</div>}
    </div>
  );
}

/** Two-part progress: known (green) then in-progress (amber), out of total. */
export function LineMeter({ known, inProgress, total, label }: { known: number; inProgress: number; total: number; label: string }) {
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div className="meter" role="img" aria-label={label}>
      <span className="known" style={{ width: pct(known) }} />
      <span className="learning" style={{ width: pct(inProgress) }} />
    </div>
  );
}

export function RepertoireTile({ rep, cards }: { rep: Repertoire; cards?: Map<string, CardRow> }) {
  const c = lineCounts(rep, cards);
  return (
    <Link to={`/openings/${rep.id}`} className={`card tile ${rep.side}`}>
      <div className="tile-side">{rep.side === 'white' ? '♔ as White' : '♚ as Black'}</div>
      <h3>{rep.title}</h3>
      <p className="muted">{rep.tagline}</p>
      <LineMeter known={c.known} inProgress={c.learning + c.due} total={c.total} label={`${c.started} of ${c.total} lines started`} />
      <div className="tile-foot">
        <span>{c.started}/{c.total} lines</span>
        {c.due > 0 && <StatusBadge status="due" />}
      </div>
    </Link>
  );
}
