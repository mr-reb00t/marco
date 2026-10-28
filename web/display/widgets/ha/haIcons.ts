// The icons of the Home Assistant cards: 24×24 strokes as static SVG strings. No imports, so the admin's icon picker
// (builder/fields.tsx) draws the same ones. The names are canvasCore HA_ICONS (the "Icono" an owner may pick).

export const g = (inner: string) =>
  `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const HA_ICON = {
  bulb: g('<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>'),
  plug: g('<path d="M9 3v5"/><path d="M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>'),
  fan: g('<circle cx="12" cy="12" r="1.6"/><path d="M12 10.4C11 7 12 3.5 14.5 3.5c2 0 2.4 3-1 6.2"/><path d="M13.6 12c3.4-1 6.9 0 6.9 2.5 0 2-3 2.4-6.2-1"/><path d="M12 13.6c1 3.4 0 6.9-2.5 6.9-2 0-2.4-3 1-6.2"/><path d="M10.4 12C7 13 3.5 12 3.5 9.5c0-2 3-2.4 6.2 1"/>'),
  thermo: g('<path d="M14 14.5V5a2 2 0 0 0-4 0v9.5a4 4 0 1 0 4 0z"/><path d="M12 9v6"/>'),
  drop: g('<path d="M12 3.5c3.5 4.3 6 7.6 6 10.6a6 6 0 0 1-12 0c0-3 2.5-6.3 6-10.6z"/>'),
  bolt: g('<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>'),
  gauge: g('<path d="M4.5 16a8 8 0 1 1 15 0"/><path d="M12 13l3.5-4"/><circle cx="12" cy="13" r="1.2"/>'),
  door: g('<path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21"/><path d="M4 21h16"/><circle cx="14.5" cy="12.5" r=".9"/>'),
  window: g('<rect x="4.5" y="3.5" width="15" height="17" rx="1.5"/><path d="M12 3.5v17M4.5 12h15"/>'),
  motion: g('<circle cx="13" cy="4.5" r="1.8"/><path d="M9 21l2.5-6.5L14 17v4"/><path d="M7 12l3-4h4l2.5 3.5H19"/><path d="M11.5 14.5 13 9"/>'),
  shutter: g('<path d="M4 4h16"/><path d="M5 4v16h14V4"/><path d="M5 8h14M5 12h14M5 16h14"/>'),
  climate: g('<path d="M12 3v18"/><path d="M5 7l14 10M19 7 5 17"/><path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>'),
  play: g('<path d="M8 5v14l11-7z"/>'),
  music: g('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  scene: g('<path d="M12 3l1.8 4.6L18.5 9l-4 3.1 1.3 4.9L12 14.3 8.2 17l1.3-4.9-4-3.1 4.7-1.4z"/>'),
  lock: g('<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
  shield: g('<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/>'),
  person: g('<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'),
  home: g('<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>'),
  sun: g('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>'),
  dot: g('<circle cx="12" cy="12" r="5"/>'),
  valve: g('<path d="M3.5 12h3.5M17 12h3.5"/><path d="M7 8.5v7l10-7v7z"/><path d="M12 12V5.5"/><path d="M9 5.5h6"/>'),
  vacuum: g('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.6"/><path d="M7.5 7.8h9"/>'),
  list: g('<path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20"/><circle cx="5" cy="6.5" r="1.1"/><circle cx="5" cy="12" r="1.1"/><circle cx="5" cy="17.5" r="1.1"/>'),
  slider: g('<path d="M4 7.5h9M19 7.5h1M4 16.5h3M13 16.5h7"/><circle cx="16" cy="7.5" r="2.4"/><circle cx="10" cy="16.5" r="2.4"/>'),
  update: g('<path d="M12 4v10.5"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/>'),
  stats: g('<path d="M4 20V11M9.5 20V5M15 20v-7M20.5 20V8"/>'),
  bell: g('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  wifi: g('<path d="M3.5 9.5a12 12 0 0 1 17 0"/><path d="M6.5 12.8a7.5 7.5 0 0 1 11 0"/><path d="M9.5 16a3.2 3.2 0 0 1 5 0"/><circle cx="12" cy="19" r=".9"/>'),
  fuel: g('<path d="M5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 14 5v15.5"/><path d="M3.5 20.5h12"/><path d="M7.5 7h4v3.5h-4z"/><path d="M14 9h1.5A1.5 1.5 0 0 1 17 10.5v5a1.25 1.25 0 0 0 2.5 0V8L17 5.5"/>'),
  car: g('<path d="M5 16.5H3.5v-4l2-5A1.5 1.5 0 0 1 6.9 6.5h10.2a1.5 1.5 0 0 1 1.4 1l2 5v4H19"/><path d="M3.5 12.5h17"/><circle cx="7.5" cy="16.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/><path d="M9.5 16.5h5"/>'),
  battery: g('<rect x="3.5" y="7.5" width="15" height="9" rx="2"/><path d="M21 10.5v3"/><path d="M6.5 10.5v3"/>'),
};
export type HaIconName = keyof typeof HA_ICON;

/** A picked icon ("Icono" of a Home Assistant card or room row), or null (none, or one this version does not have). */
export function haIconOf(v: unknown): HaIconName | null {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(HA_ICON, v) ? (v as HaIconName) : null;
}

/** A battery filled to `pct` (0 to 100). */
export function batteryIcon(pct: number): string {
  const w = Math.round((Math.max(0, Math.min(100, pct)) / 100) * 110) / 10;
  return g(`<rect x="3.5" y="7.5" width="15" height="9" rx="2"/><path d="M21 10.5v3"/>${w > 0 ? `<rect x="5.5" y="9.5" width="${w}" height="5" rx="0.6" fill="currentColor" stroke="none"/>` : ''}`);
}
