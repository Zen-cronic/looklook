import type { ReactNode } from "react";

/**
 * A small label above a section or card: a tiny drawn icon in the signature
 * colour, then the words. No pill around it.
 */
const ICONS = {
  // A phone screen with a post on it
  post: <path d="M5 1.75h6a1.25 1.25 0 011.25 1.25v10A1.25 1.25 0 0111 14.25H5A1.25 1.25 0 013.75 13V3A1.25 1.25 0 015 1.75zM5.75 4.5h4.5v4h-4.5zM7 11.75h2" />,
  // A circle with a tick: a checked answer
  check: <path d="M8 1.9a6.1 6.1 0 110 12.2A6.1 6.1 0 018 1.9zM5.4 8.2l1.8 1.8 3.5-3.9" />,
  // A bottle on a shelf line
  shelf: <path d="M6.5 1.75h3v2.1l1.25 1.4v7.5a.9.9 0 01-.9.9H6.15a.9.9 0 01-.9-.9v-7.5l1.25-1.4zM5.25 8h5.5M2 14.25h12" />,
  // Three bars of a chart
  chart: <path d="M2 14.25h12M4 11.5V8.5M8 11.5V3.5M12 11.5V6" />,
  // A hand-drawn "yes": a tick in a rounded square
  yes: <path d="M3.5 2h9A1.5 1.5 0 0114 3.5v9a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9A1.5 1.5 0 013.5 2zM5.2 8.2l1.9 1.9 3.8-4.2" />,
  // A receipt with a torn foot
  receipt: <path d="M3.75 1.75h8.5v12.5l-1.4-1-1.4 1-1.45-1-1.45 1-1.4-1-1.4 1zM6 5.25h4M6 8h4" />,
  // A clock: the date and time
  clock: <path d="M8 1.9a6.1 6.1 0 110 12.2A6.1 6.1 0 018 1.9zM8 4.6V8l2.3 1.5" />,
  // A flag on a pole: a step to take
  step: <path d="M4 14.25V1.75M4 2.5h8l-1.75 2.75L12 8H4" />,
  // A price tag: a sample or a test
  tag: <path d="M2 2.75v4.6l6.6 6.6a1 1 0 001.4 0l3.95-3.95a1 1 0 000-1.4L7.35 2H2.75A.75.75 0 002 2.75zM5 5.25h.01" />,
  // A circle with a mark: something to look at
  alert: <path d="M8 1.9a6.1 6.1 0 110 12.2A6.1 6.1 0 018 1.9zM8 4.75v3.9M8 11.1v.05" />,
  // Two turning arrows: a repeat
  repeat: <path d="M3 6.25a5 5 0 018.9-2.1M13 9.75a5 5 0 01-8.9 2.1M12 1.75v2.6H9.4M4 14.25v-2.6h2.6" />,
  // A card
  card: <path d="M2.75 3.75h10.5A1.25 1.25 0 0114.5 5v6a1.25 1.25 0 01-1.25 1.25H2.75A1.25 1.25 0 011.5 11V5a1.25 1.25 0 011.25-1.25zM1.5 6.5h13M4 10h3" />,
} as const;

export type EyebrowIcon = keyof typeof ICONS;

export function Eyebrow(props: { icon: EyebrowIcon; children: ReactNode; as?: "p" | "h2" | "h3" | "span"; className?: string; id?: string }) {
  const Tag = props.as ?? "p";
  return (
    <Tag className={`eyebrow${props.className ? ` ${props.className}` : ""}`} id={props.id}>
      <svg className="eyebrow-icon" viewBox="0 0 16 16" aria-hidden="true">
        {ICONS[props.icon]}
      </svg>
      <span>{props.children}</span>
    </Tag>
  );
}
