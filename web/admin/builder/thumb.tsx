// Small drawings of a Personalizado layout: the template cards, the Personalizado card of Diseño and the style card.
// Each item is drawn where it really is, in its category's colour, from the canvas data itself (no screenshot).
import type { CanvasConfig, CanvasKind } from '../../shared/types';
import { CANVAS_KINDS } from '../../../server/core/canvasCore.js';
import { geometryBoxes } from './thumbGeo';

const CAT_COLOR: Record<string, string> = {
  time: '#ff9f1c', calendar: '#4c8dff', weather: '#2ec4b6', content: '#9b5de5', nav: '#06d6a0', family: '#f15bb5', home: '#00bbf9', adv: '#8d99ae',
};
export const colorOfKind = (k: CanvasKind | string): string => CAT_COLOR[CANVAS_KINDS[k as CanvasKind]?.cat ?? 'adv'] ?? '#8d99ae';

/** A canvas drawn small (160×90, or 90×160 in portrait). */
export function CanvasThumb({ cv, portrait = false, light = false }: { cv: CanvasConfig; portrait?: boolean; light?: boolean }) {
  const W = portrait ? 90 : 160;
  const H = portrait ? 160 : 90;
  const { side, sidePhoto, items } = geometryBoxes(cv, portrait ? 'portrait' : 'landscape', W, H);
  const bg = cv.background === 'photo' ? 'url(#cvt-ph)' : cv.background === 'solid' ? (cv.color ?? (light ? '#f4f2ee' : '#0d0e12')) : light ? '#e9e6f2' : 'url(#cvt-amb)';
  const sideFill = sidePhoto || cv.sidebar.fill === 'photo' ? 'url(#cvt-ph)' : cv.sidebar.fill === 'solid' ? (light ? '#ffffff' : '#1c1c22') : light ? 'rgb(255 255 255 / .55)' : 'rgb(255 255 255 / .14)';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="schematic cv-thumb" aria-hidden="true">
      <defs>
        <linearGradient id="cvt-ph" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2b3d63" />
          <stop offset="0.55" stop-color="#7a4b63" />
          <stop offset="1" stop-color="#d0875e" />
        </linearGradient>
        <radialGradient id="cvt-amb" cx="0.3" cy="0.2" r="1">
          <stop offset="0" stop-color="#3a2f6b" />
          <stop offset="0.6" stop-color="#161a33" />
          <stop offset="1" stop-color="#0b0c14" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} rx="6" fill={bg} />
      {side && <rect x={side.x} y={side.y} width={side.w} height={side.h} fill={sideFill} />}
      {items.map((b) => (
        <rect
          x={b.x}
          y={b.y}
          width={Math.max(1, b.w)}
          height={Math.max(1, b.h)}
          rx="2.2"
          fill={b.surface === 'none' ? 'none' : colorOfKind(b.kind)}
          fill-opacity={b.hidden ? 0.15 : 0.72}
          stroke={colorOfKind(b.kind)}
          stroke-opacity={b.surface === 'none' || b.hidden ? 0.9 : 0}
          stroke-dasharray={b.hidden || b.surface === 'none' ? '2 1.5' : undefined}
          stroke-width="0.8"
        />
      ))}
    </svg>
  );
}

/** The mixed tiles of the Personalizado style card. */
export function CanvasStyleThumb() {
  const tiles: [number, number, number, number, string][] = [
    [6, 6, 52, 34, CAT_COLOR.time], [68, 14, 86, 44, CAT_COLOR.calendar], [6, 44, 52, 18, CAT_COLOR.weather],
    [6, 66, 24, 18, CAT_COLOR.family], [34, 66, 24, 18, CAT_COLOR.content], [62, 60, 92, 24, CAT_COLOR.weather],
  ];
  return (
    <svg viewBox="0 0 160 90" class="schematic" aria-hidden="true">
      <defs>
        <radialGradient id="cvs-amb" cx="0.3" cy="0.2" r="1">
          <stop offset="0" stop-color="#3a2f6b" />
          <stop offset="0.6" stop-color="#161a33" />
          <stop offset="1" stop-color="#0b0c14" />
        </radialGradient>
      </defs>
      <rect width="160" height="90" rx="6" fill="url(#cvs-amb)" />
      {tiles.map(([x, y, w, h, c]) => (
        <rect x={x} y={y} width={w} height={h} rx="4" fill={c} fill-opacity=".55" stroke="#fff" stroke-opacity=".35" stroke-width=".6" />
      ))}
      <text x="12" y="26" fill="#fff" font-size="13" font-weight="600" font-family="system-ui, sans-serif">
        9:41
      </text>
      {/* a card being moved: its dashed spot and the mouse pointer */}
      <rect x="62" y="6" width="92" height="50" rx="4" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".7" stroke-dasharray="3 2" />
      <path d="M0 0 V11.5 L3 8.7 L5.4 13.6 L7.4 12.7 L5.1 7.9 H9.2 Z" transform="translate(112 30)" fill="#fff" stroke="#0b0c14" stroke-width=".8" stroke-linejoin="round" />
    </svg>
  );
}
