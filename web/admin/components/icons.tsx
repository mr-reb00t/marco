import type { SVGAttributes } from 'preact';

// Minimal stroke icon set (Lucide-style, 24x24, currentColor).
const P: Record<string, string> = {
  layout: 'M3 4h18v16H3z M9 4v16 M9 12h12',
  widget: 'M5 4h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M15 3.5h4.5a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1H15a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z M5 13h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z M14 13h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z',
  image: 'M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M15.5 9.5a1.5 1.5 0 1 0 0-.01',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5',
  sparkles: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  cloud: 'M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 10.2 4 4 0 0 0 7 18z',
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2z M17 9h3v8a2 2 0 0 1-2 2 M8 9h5 M8 13h5 M8 16h3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  checklist: 'M4 6l1.5 1.5L8 5 M4 12l1.5 1.5L8 11 M4 18l1.5 1.5L8 17 M11 6.5h9 M11 12.5h9 M11 18.5h9',
  message: 'M4 5h16v11H9l-5 4z',
  home: 'M3 11l9-7 9 7 M5 10v10h14V10 M10 20v-6h4v6',
  photos: 'M7 7h14v12H7z M3 4v12 M3 4h14 M7 16l4-4 3 3 2-2 5 5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z M9 12l2 2 4-4',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  trend: 'M3 17l6-6 4 4 8-8 M15 7h6v6',
  exchange: 'M4 8h15 M15 4l4 4-4 4 M20 16H5 M9 12l-4 4 4 4',
  coins: 'M9 13a6 4 0 1 0 0-.01 M3 13v4c0 2.2 2.7 4 6 4s6-1.8 6-4v-4 M9 5a6 3.5 0 0 1 12 0c0 1.5-1.5 2.8-3.7 3.4 M21 5v4c0 1.5-1.4 2.8-3.5 3.5',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0z M8 6H5a3 3 0 0 0 3 4 M16 6h3a3 3 0 0 1-3 4 M12 13v4 M8 21h8 M10 17h4v4h-4z',
  monitor: 'M3 4h18v12H3z M8 20h8 M12 16v4',
  refresh: 'M20 11a8 8 0 0 0-14.9-3.9L4 9 M4 4v5h5 M4 13a8 8 0 0 0 14.9 3.9L20 15 M20 20v-5h-5',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4 M10 16l-4-4 4-4 M6 12h11',
  plus: 'M12 5v14 M5 12h14',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  up: 'M12 19V5 M6 11l6-6 6 6',
  down: 'M12 5v14 M6 13l6 6 6-6',
  chevron: 'm6 9 6 6 6-6',
  left: 'm15 6-6 6 6 6',
  right: 'm9 6 6 6-6 6',
  grip: 'M9 6h.01 M9 12h.01 M9 18h.01 M15 6h.01 M15 12h.01 M15 18h.01',
  x: 'M6 6l12 12 M18 6L6 18',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.8 M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1 M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  key: 'M15 7a4 4 0 1 0-3.5 6L4 20.5V22h3v-2h2v-2h2l1.5-1.5A4 4 0 0 0 15 7z M16 7h.01',
  play: 'M7 4l13 8-13 8z',
  undo: 'M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-5-5',
  alert: 'M12 3l10 18H2z M12 10v4 M12 17h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v6 M12 7.5h.01',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.6 9.3a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.2-2.5 3.6 M12 17h.01',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  tag: 'M3 12V4h8l10 10-8 8z M7.5 8.5h.01',
  google: '',
  microsoft: '',
  apple: '',
  palette: 'M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3.5 3H16a2 2 0 0 0-1.5 3.3c.4.5.5 1 .5 1.4 0 .8-1 1.3-3 1.3z M7.5 11h.01 M10 7h.01 M14.5 7h.01 M17 11h.01',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
  wand: 'M4 20L16 8 M14 6l4 4 M19 3v3 M17.5 4.5h3 M8 3v2 M7 4h2 M20 13v2 M19 14h2',
  cake: 'M4 21h16 M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7 M5 16c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 M12 12V8 M12 5.5a1.2 1.2 0 0 1-1.2-1.2C10.8 3.2 12 2 12 2s1.2 1.2 1.2 2.3A1.2 1.2 0 0 1 12 5.5z',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.9 1.9 0 0 0 3.4 0',
  megaphone: 'M3 11v3a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z M15.5 8.5a5 5 0 0 1 0 7 M18.5 5.5a9 9 0 0 1 0 13',
  filter: 'M3 5h18l-7 8.5V19l-4 2v-7.5z',
  hourglass: 'M6 2h12 M6 22h12 M7 2v4a5 5 0 0 0 10 0V2 M7 22v-4a5 5 0 0 1 10 0v4',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  download: 'M12 4v12 M7 11l5 5 5-5 M4 20h16',
  archive: 'M3 4h18v4H3z M5 8v12h14V8 M10 12h4',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3.5 6h.01 M3.5 12h.01 M3.5 18h.01',
  zap: 'M13 2L4 14h7l-1 8 9-12h-7z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  code: 'M8 7l-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16',
  edit: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
  repeat: 'M17 2l4 4-4 4 M3 11V9a3 3 0 0 1 3-3h15 M7 22l-4-4 4-4 M21 13v2a3 3 0 0 1-3 3H3',
  wifi: 'M5 12.5a10 10 0 0 1 14 0 M8.5 16a5 5 0 0 1 7 0 M2 9a15 15 0 0 1 20 0 M12 19.5h.01',
  wifiOff: 'M3 3l18 18 M8.5 16a5 5 0 0 1 7 0 M5 12.5a10 10 0 0 1 5-2.7 M14.5 9.9a10 10 0 0 1 4.5 2.6 M2 9a15 15 0 0 1 4.3-2.8 M10.7 5.1A15 15 0 0 1 22 9 M12 19.5h.01',
  home2: 'M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5 M12 7v5l3 2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  utensils: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2 M7 2v20 M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3z M21 15v7',
  command: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z',
  enter: 'M20 5v7a3 3 0 0 1-3 3H5 M9 11l-4 4 4 4',
  volume: 'M4 9v6h4l5 4V5L8 9z M16 9a4 4 0 0 1 0 6 M19 6a8 8 0 0 1 0 12',
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 12 2.5a7 7 0 0 1 7 7C19 14.8 12 21 12 21z M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, class: cls, ...rest }: { name: IconName; size?: number; class?: string } & SVGAttributes<SVGSVGElement>) {
  if (name === 'google') return <GoogleG size={size} />;
  if (name === 'microsoft') return <MicrosoftLogo size={size} />;
  if (name === 'apple') return <AppleLogo size={size} />;
  return (
    <svg
      class={`ico ${cls ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={P[name]} />
    </svg>
  );
}

export function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** The four squares of the Microsoft logo, for the Microsoft accounts card and Microsoft calendars. */
export function MicrosoftLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 23 23" aria-hidden="true">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}

/** The Apple logo in the text color (works in both themes), for the Apple iCloud option of the linked accounts card. */
export function AppleLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
      />
    </svg>
  );
}
