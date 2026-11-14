import type { SVGProps } from 'react';

const base = (props: SVGProps<SVGSVGElement>) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
});

export const HomeIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /></svg>
);
export const BookIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 18.5V5.5M8 7h8" /></svg>
);
export const PuzzleIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4h-4a2 2 0 1 1-4 0H5v-4a2 2 0 1 1 0-4V4z" /></svg>
);
export const GamesIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 12h16M12 4v16" /></svg>
);
export const PlayIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 5.5v13l10-6.5z" /></svg>
);
export const StatsIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
);
export const GearIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
);
export const SunIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const MoonIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
);
export const SoundOnIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 10v4h4l5 4V6L8 10z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></svg>
);
export const SoundOffIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 10v4h4l5 4V6L8 10z" /><path d="M17 9l4 6M21 9l-4 6" /></svg>
);
export const TargetIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>
);
export const TodayIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16M9 3v4M15 3v4" /><path d="m9.5 15 1.8 1.8 3.4-3.6" /></svg>
);
export const CrownIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 19h14" /><path d="M5.5 15.5 4 7l4.5 3.5L12 5l3.5 5.5L20 7l-1.5 8.5z" /></svg>
);
export const TrendIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 20h16" /><path d="m5 15 4.5-5 3.5 3L19 6" /><path d="M15 6h4v4" /></svg>
);
export const MenuIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 7h16M4 12h16M4 17h10" /></svg>
);
export const ArrowLeftIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
);
export const ArrowRightIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
export const FlameIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3c.5 3.5 5 5.5 5 10.5a5 5 0 0 1-10 0c0-2 1-3.2 2-4 .2 1.6 1 2.5 2 3 .2-3.5-.5-6.5 1-9.5z" /></svg>
);
export const SwordsIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 4h3l9.5 9.5M4 5v3l9.5 9.5" /><path d="m14 18 4-4M16.5 16.5 20 20" /><path d="M19 4h-3l-4 4M20 5v3l-4 4" /><path d="m6 14 4 4M7.5 16.5 4 20" /></svg>
);
export const CompassIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></svg>
);
export const BoltIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M13 3 5 13.5h6L10 21l9-11h-6z" /></svg>
);
export const ClockIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
/** The brand mark: a 2x2 corner of a board with one square lit. */
export const BrandMark = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 32 32" aria-hidden {...p}>
    <rect width="32" height="32" rx="8" fill="var(--text)" />
    <rect x="7" y="7" width="8.5" height="8.5" rx="1.5" fill="var(--bg)" opacity="0.92" />
    <rect x="16.5" y="16.5" width="8.5" height="8.5" rx="1.5" fill="var(--bg)" opacity="0.92" />
    <rect x="16.5" y="7" width="8.5" height="8.5" rx="1.5" fill="var(--tint)" />
    <rect x="7" y="16.5" width="8.5" height="8.5" rx="1.5" fill="var(--bg)" opacity="0.28" />
  </svg>
);
