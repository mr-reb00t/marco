import type { ComponentType } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CALENDAR_BLUR_DEFAULT, CALENDAR_OPACITY_DEFAULT, GLASS_DEFAULTS, glassVars, normalizeGlass, SCREEN_PHOTO_PRESETS, type PhotoStats } from '../../shared/glass';
import type { BackgroundScope, CanvasConfig, DisplayStyle, FrameCorner, GlassConfig, LayoutPreset, PlannerBar, WidgetPlacement } from '../../shared/types';
import { CANVAS_GLASS_DEFAULTS, defaultCanvas, startCanvasGlass, canvasCards } from '../../../server/core/canvasCore.js';
import { CanvasStyleThumb, CanvasThumb } from '../builder/thumb';
import { Icon } from '../components/icons';
import { EventStyleField, PLANNER_CALENDAR, undoPlannerPick, weeksCap, WeeksField } from '../components/PlannerFields';
import { Button, Callout, Card, ColorPicker, Field, PageHeader, ReorderButtons, Segmented, Select, Slider, ToggleRow } from '../components/ui';
import { has } from '../caps';
import { t } from '../i18n';
import { allSourceOptions, MAX_SCREEN_WIDGETS, moveItem } from '../util';
import type { SectionProps } from './common';
import { FamilyScreenOptions } from './Family';
import { SpotifyAccountSelect } from './Spotify';

export const PRESETS: { id: LayoutPreset; name: string; desc: string; wizard?: boolean; group?: 'kids' }[] = [
  { id: 'bigCalendar', name: 'Calendario grande', desc: 'Mes completo a pantalla grande con reloj, tiempo y noticias en una columna lateral.', wizard: true },
  { id: 'twoWeeks', name: 'Dos semanas', desc: 'Esta semana y la siguiente, con más sitio para cada día. Hoy se ve resaltado.' },
  { id: 'leftRight', name: 'Izquierda / Derecha', desc: 'Foto a un lado; reloj, tiempo y agenda al otro. Ideal para pantallas horizontales.', wizard: true },
  { id: 'topBottom', name: 'Arriba / Abajo', desc: 'Reloj y tiempo arriba, calendario abajo. Perfecto para pantallas verticales o tablets.', wizard: true },
  { id: 'agenda', name: 'Agenda', desc: 'Lista de próximos eventos agrupados por día, legible desde lejos (móvil / tablet).', wizard: true },
  { id: 'today', name: 'Hoy', desc: 'El día hora a hora con una línea de ahora, el próximo evento en grande y el tiempo de las próximas horas. Para la cocina por la mañana.' },
  { id: 'people', name: 'Por persona', desc: 'Una columna por persona (por calendario) con lo de hoy y lo de mañana.' },
  { id: 'board', name: 'Tablero', desc: 'Organización familiar: tareas, cuentas atrás, mensaje del día, próximos cumpleaños y una agenda corta.' },
  { id: 'bigTime', name: 'Hora grande', desc: 'Reloj protagonista sobre la foto, con la agenda de hoy y mañana.', wizard: true },
  { id: 'photoFrame', name: 'Marco de fotos', desc: 'La foto es la protagonista: solo un reloj pequeño, la temperatura y el próximo evento en una esquina. Ideal para un marco vertical.' },
  { id: 'bedside', name: 'Mesilla', desc: 'Reloj enorme, el próximo evento y la temperatura con muy poco brillo, para el dormitorio. Se atenúa más por la noche.' },
  { id: 'planner', name: 'Planificador', desc: 'Para familias con muchas citas: el mes con tarjetas que llenan cada día, y el reloj, la fecha y el tiempo arriba. En pantallas horizontales también pueden ir al lado o abajo.' },
  { id: 'widget', name: 'Widget', desc: 'Un widget ocupa toda la pantalla. Útil en carruseles.' },
  // kids layouts (Familia): Modern style only, the display shows the big calendar with Classic
  { id: 'kidsRoutines', name: 'Rutinas', desc: 'Una columna por niño con sus rutinas de mañana, tarde y noche, su progreso y sus estrellas.', group: 'kids' },
  { id: 'kidsFamily', name: 'Familia', desc: 'El día de toda la familia: agenda de hoy, rutinas, comidas y tareas, con un saludo arriba.', group: 'kids' },
  { id: 'kidsMeals', name: 'Semana de comidas', desc: 'El menú de toda la semana con hoy resaltado, la hora y lo próximo de hoy.', group: 'kids' },
  // Personalizado (screen.canvas): picked from the style cards, not from this grid (shown here only while it is the layout)
  { id: 'canvas', name: 'Personalizado', desc: 'Coloca tú los widgets en una cuadrícula: relojes, calendarios, el tiempo, fotos y más, cada uno con su tamaño y su aspecto.' },
];
const isKidsPreset = (id: string) => PRESETS.some((p) => p.id === id && p.group === 'kids');

/**
 * The planner's drawing: the month with cards, and the clock and the weather in the side column (layout.plannerBar
 * 'side') or in a low strip above or below the month.
 */
function PlannerSchematic({ bar, side }: { bar: PlannerBar; side: 'left' | 'right' }) {
  const accent = 'var(--accent)';
  const block = 'var(--schem-block)';
  const L = side === 'left';
  // the strip, or the side column, and the area left for the month
  const strip = bar === 'side' ? { x: L ? 6 : 114, y: 6, w: 40, h: 78 } : { x: 6, y: bar === 'top' ? 6 : 70, w: 148, h: 14 };
  const grid = bar === 'side' ? { x: L ? 50 : 6, y: 8, w: 104, h: 76 } : { x: 6, y: bar === 'top' ? 24 : 6, w: 148, h: 60 };
  const rows = 3;
  const cw = grid.w / 7;
  const rh = grid.h / rows;
  return (
    <g>
      <rect x={strip.x} y={strip.y} width={strip.w} height={strip.h} rx="4" fill={block} opacity="0.9" />
      {bar === 'side' ? (
        <>
          <rect x={strip.x + 5} y={strip.y + 6} width="26" height="10" rx="2" fill={accent} />
          <rect x={strip.x + 5} y={strip.y + 20} width="20" height="3" rx="1.5" fill="var(--schem-line)" opacity=".6" />
          <rect x={strip.x + 5} y={strip.y + 52} width="30" height="20" rx="3" fill="var(--schem-line)" opacity=".5" />
        </>
      ) : (
        <>
          <rect x={strip.x + 5} y={strip.y + 3} width="24" height="8" rx="2" fill={accent} />
          <rect x={strip.x + 33} y={strip.y + 4} width="22" height="2.6" rx="1.3" fill="var(--schem-line)" opacity=".6" />
          <rect x={strip.x + 33} y={strip.y + 8} width="16" height="2.6" rx="1.3" fill="var(--schem-line)" opacity=".4" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect x={strip.x + 84 + i * 10} y={strip.y + 3} width="7" height="8" rx="1.5" fill="var(--schem-line)" opacity={i === 0 ? 0.6 : 0.4} />
          ))}
        </>
      )}
      {Array.from({ length: rows }, (_, r) =>
        [0, 1, 2, 3, 4, 5, 6].map((c) => (
          <g>
            {[0, 1, 2].slice(0, 1 + ((r + c) % 3)).map((k) => (
              <rect
                x={grid.x + 0.6 + c * cw}
                y={grid.y + 0.6 + r * rh + 4 + k * 4.4}
                width={cw - 1.2}
                height="3.6"
                rx="0.8"
                fill={['#4c8dff', '#ff9f1c', '#9b5de5', '#2ec4b6'][(r + c + k) % 4]}
                opacity=".75"
              />
            ))}
            <rect x={grid.x + 0.6 + c * cw} y={grid.y + 0.6 + r * rh} width="5" height="2.4" rx="0.8" fill="var(--schem-line)" opacity=".6" />
          </g>
        )),
      )}
      <rect x={grid.x + 4 * cw} y={grid.y} width={cw} height={rh} rx="1.5" fill="none" stroke={accent} stroke-width="1.2" />
    </g>
  );
}

/** Tiny schematic drawing of each layout preset. */
export function Schematic({ id, side, plannerBar = 'side' }: { id: LayoutPreset; side: 'left' | 'right'; plannerBar?: PlannerBar }) {
  const accent = 'var(--accent)';
  const block = 'var(--schem-block)';
  const photo = `url(#ph-${id})`;
  const L = side === 'left';
  const cells = (x: number, y: number, w: number, h: number, cols: number, rows: number) => {
    const out = [];
    const cw = w / cols;
    const ch = h / rows;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        out.push(<rect x={x + c * cw + 0.6} y={y + r * ch + 0.6} width={cw - 1.2} height={ch - 1.2} rx={1} fill={block} opacity={r === 1 && c === 3 ? 1 : 0.55} />);
    return out;
  };
  return (
    <svg viewBox="0 0 160 90" class="schematic" aria-hidden="true">
      <defs>
        <linearGradient id={`ph-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2b3d63" />
          <stop offset="0.55" stop-color="#7a4b63" />
          <stop offset="1" stop-color="#d0875e" />
        </linearGradient>
      </defs>
      <rect width="160" height="90" rx="6" fill={photo} />
      <path d="M0 70 L40 48 L70 62 L105 40 L160 66 L160 90 L0 90 Z" fill="#000" opacity=".28" />
      {id === 'bigCalendar' && (
        <g>
          <rect x={L ? 6 : 108} y="6" width="46" height="78" rx="4" fill={block} opacity="0.9" />
          <rect x={L ? 11 : 113} y="12" width="30" height="8" rx="2" fill={accent} />
          <rect x={L ? 11 : 113} y="25" width="20" height="4" rx="2" fill="var(--schem-line)" />
          <rect x={L ? 11 : 113} y="40" width="36" height="14" rx="3" fill="var(--schem-line)" opacity=".5" />
          {cells(L ? 56 : 6, 6, 98, 78, 7, 5)}
          <rect x={(L ? 56 : 6) + 3 * 14 + 1} y={6 + 15.6 + 1} width="12" height="13.6" rx="1.5" fill="none" stroke={accent} stroke-width="1.4" />
        </g>
      )}
      {id === 'leftRight' && (
        <g>
          <rect x={L ? 6 : 82} y="6" width="72" height="78" rx="4" fill={block} opacity="0.9" />
          <rect x={L ? 12 : 88} y="13" width="40" height="11" rx="2" fill={accent} />
          <rect x={L ? 12 : 88} y="29" width="26" height="4" rx="2" fill="var(--schem-line)" />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect x={L ? 12 : 88} y={42 + i * 8} width={56 - (i % 2) * 14} height="5" rx="2" fill="var(--schem-line)" opacity=".55" />
          ))}
        </g>
      )}
      {id === 'topBottom' && (
        <g>
          <rect x="6" y="6" width="148" height="24" rx="4" fill={block} opacity="0.9" />
          <rect x="12" y="11" width="38" height="14" rx="2" fill={accent} />
          <rect x="112" y="12" width="36" height="12" rx="3" fill="var(--schem-line)" opacity=".5" />
          {cells(6, 34, 148, 50, 7, 3)}
        </g>
      )}
      {id === 'bigTime' && (
        <g>
          <rect x="40" y="22" width="80" height="26" rx="4" fill={accent} />
          <rect x="58" y="53" width="44" height="4" rx="2" fill="var(--schem-line)" />
          <rect x="6" y="66" width="148" height="18" rx="4" fill={block} opacity="0.9" />
          {[0, 1, 2].map((i) => (
            <rect x={12 + i * 48} y="71" width="40" height="8" rx="2" fill="var(--schem-line)" opacity=".55" />
          ))}
        </g>
      )}
      {id === 'twoWeeks' && (
        <g>
          <rect x={L ? 6 : 116} y="6" width="38" height="78" rx="4" fill={block} opacity="0.9" />
          <rect x={L ? 11 : 121} y="12" width="26" height="8" rx="2" fill={accent} />
          <rect x={L ? 11 : 121} y="25" width="18" height="4" rx="2" fill="var(--schem-line)" />
          {cells(L ? 48 : 6, 6, 106, 78, 7, 2)}
          <rect x={(L ? 48 : 6) + 3 * 15.14 + 0.6} y={45.6} width="13.9" height="37.8" rx="1.5" fill="none" stroke={accent} stroke-width="1.4" />
        </g>
      )}
      {id === 'today' && (
        <g>
          <rect x="6" y="6" width="44" height="78" rx="4" fill={block} opacity="0.9" />
          <rect x="11" y="12" width="28" height="8" rx="2" fill={accent} />
          <rect x="11" y="62" width="34" height="16" rx="3" fill="var(--schem-line)" opacity=".5" />
          <rect x="54" y="6" width="100" height="78" rx="4" fill={block} opacity="0.9" />
          <rect x="58" y="10" width="92" height="16" rx="3" fill="var(--schem-line)" opacity=".35" />
          <rect x="62" y="14" width="40" height="5" rx="2" fill="var(--schem-line)" />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect x="66" y={32 + i * 10} width="84" height=".8" fill="var(--schem-line)" opacity=".45" />
          ))}
          <rect x="68" y="35" width="60" height="7" rx="1.5" fill="#4c8dff" opacity=".7" />
          <rect x="68" y="62" width="46" height="7" rx="1.5" fill="#2ec4b6" opacity=".7" />
          <rect x="60" y="51" width="90" height="1.4" fill={accent} />
          <circle cx="62" cy="51.7" r="2" fill={accent} />
        </g>
      )}
      {id === 'people' && (
        <g>
          <rect x="6" y="6" width="148" height="20" rx="4" fill={block} opacity="0.9" />
          <rect x="12" y="10" width="34" height="12" rx="2" fill={accent} />
          {[0, 1, 2, 3].map((i) => (
            <g>
              <rect x={6 + i * 37.5} y="30" width="35" height="54" rx="3" fill={block} opacity=".75" />
              <circle cx={13 + i * 37.5} cy="37" r="3.6" fill={['#4c8dff', '#ff9f1c', '#2ec4b6', '#9b5de5'][i]} />
              {[0, 1, 2].map((j) => (
                <rect x={10 + i * 37.5} y={46 + j * 9} width={26 - ((i + j) % 2) * 8} height="4" rx="1.5" fill="var(--schem-line)" opacity=".55" />
              ))}
            </g>
          ))}
        </g>
      )}
      {id === 'board' && (
        <g>
          <rect x="12" y="9" width="34" height="12" rx="2" fill={accent} />
          <rect x="116" y="9" width="32" height="12" rx="3" fill="var(--schem-line)" opacity=".5" />
          <rect x="6" y="28" width="47" height="56" rx="4" fill={block} opacity=".9" />
          <rect x="57" y="28" width="46" height="18" rx="4" fill={block} opacity=".9" />
          <rect x="57" y="50" width="46" height="34" rx="4" fill={block} opacity=".9" />
          <rect x="107" y="28" width="47" height="30" rx="4" fill={block} opacity=".9" />
          <rect x="107" y="62" width="47" height="22" rx="4" fill={block} opacity=".9" />
          {[0, 1, 2, 3].map((i) => (
            <rect x="11" y={36 + i * 9} width={36 - (i % 2) * 10} height="4" rx="1.5" fill="var(--schem-line)" opacity=".55" />
          ))}
          <rect x="62" y="34" width="34" height="5" rx="2" fill="var(--schem-line)" />
          {[0, 1, 2].map((i) => (
            <g>
              <circle cx="64" cy={59 + i * 8} r="2.2" fill="none" stroke="var(--schem-line)" stroke-width="1" />
              <rect x="69" y={57.5 + i * 8} width={26 - i * 5} height="3" rx="1.5" fill="var(--schem-line)" opacity=".55" />
            </g>
          ))}
        </g>
      )}
      {id === 'photoFrame' && (
        <g>
          <rect x="112" y="54" width="42" height="30" rx="5" fill={block} opacity="0.85" />
          <rect x="117" y="59" width="26" height="9" rx="2" fill="var(--schem-line)" />
          <rect x="117" y="72" width="16" height="3.5" rx="1.5" fill="var(--schem-line)" opacity=".6" />
          <rect x="117" y="78" width="30" height="3" rx="1.5" fill={accent} opacity=".8" />
        </g>
      )}
      {id === 'planner' && <PlannerSchematic bar={plannerBar} side={side} />}
      {id === 'widget' && (
        <g>
          <rect x="12" y="9" width="136" height="72" rx="7" fill={block} opacity=".92" />
          <path d="M52 62 L70 42 L82 54 L92 46 L108 62 Z" fill="var(--schem-line)" opacity=".7" />
          <circle cx="98" cy="32" r="5" fill={accent} />
          <rect x="52" y="28" width="56" height="34" rx="3" fill="none" stroke="var(--schem-line)" stroke-width="1.6" opacity=".7" />
        </g>
      )}
      {id === 'bedside' && (
        <g>
          <rect width="160" height="90" rx="6" fill="#050505" />
          <text x="80" y="54" text-anchor="middle" fill="#c99a76" opacity=".75" font-size="30" font-weight="300" font-family="system-ui, sans-serif">
            7:05
          </text>
          <rect x="52" y="64" width="56" height="3.5" rx="1.5" fill="#c99a76" opacity=".4" />
        </g>
      )}
      {id === 'agenda' && (
        <g>
          <rect x="6" y="6" width="148" height="16" rx="4" fill={block} opacity="0.9" />
          <rect x="12" y="10" width="30" height="8" rx="2" fill={accent} />
          {[0, 1, 2, 3].map((i) => (
            <g>
              <rect x="6" y={26 + i * 15} width="148" height="12" rx="3" fill={block} opacity=".7" />
              <rect x="10" y={29 + i * 15} width="3" height="6" rx="1" fill={accent} />
              <rect x="18" y={30 + i * 15} width={70 - i * 9} height="4" rx="2" fill="var(--schem-line)" />
            </g>
          ))}
        </g>
      )}
      {id === 'kidsRoutines' && (
        <g>
          <rect width="160" height="90" rx="6" fill="#f6f3ee" />
          <rect x="8" y="7" width="30" height="9" rx="2" fill="#2b2b33" opacity=".85" />
          <rect x="8" y="18" width="20" height="3" rx="1.5" fill="#2b2b33" opacity=".35" />
          <rect x="136" y="6" width="16" height="16" rx="2.5" fill="#fff" stroke="#2b2b33" stroke-opacity=".12" stroke-width=".6" />
          <path d="M139 9h4v4h-4z M145 9h4v4h-4z M139 15h4v4h-4z M146 16h2v2h-2z" fill="#2b2b33" opacity=".75" />
          {['#ff8fab', '#7cc6fe', '#9be3a0'].map((c, i) => (
            <g>
              <rect x={8 + i * 49} y="27" width="45" height="57" rx="5" fill="#fff" />
              <circle cx={16 + i * 49} cy="35" r="4.5" fill={c} opacity=".45" stroke={c} stroke-width="1.2" />
              <rect x={23 + i * 49} y="32.5" width="16" height="3.5" rx="1.5" fill="#2b2b33" opacity=".7" />
              <rect x={12 + i * 49} y="43" width="37" height="2.4" rx="1.2" fill="#000" opacity=".07" />
              <rect x={12 + i * 49} y="43" width={[24, 14, 30][i]} height="2.4" rx="1.2" fill={c} />
              {[0, 1, 2].map((j) => (
                <g>
                  <rect x={12 + i * 49} y={49 + j * 11} width="37" height="9" rx="2.5" fill={c} opacity={(i + j) % 2 ? 0.12 : 0.28} />
                  <circle cx={44 + i * 49} cy={53.5 + j * 11} r="2.6" fill={(i + j) % 2 ? 'none' : c} stroke={c} stroke-width="1" />
                  <rect x={15 + i * 49} y={52.2 + j * 11} width={18 - j * 3} height="2.6" rx="1.2" fill="#2b2b33" opacity=".55" />
                </g>
              ))}
            </g>
          ))}
        </g>
      )}
      {id === 'kidsFamily' && (
        <g>
          <rect width="160" height="90" rx="6" fill="#f6f3ee" />
          <rect x="8" y="7" width="44" height="7" rx="2" fill="#2b2b33" opacity=".8" />
          <rect x="8" y="17" width="60" height="3" rx="1.5" fill="#2b2b33" opacity=".35" />
          <rect x="118" y="7" width="22" height="9" rx="2" fill="#2b2b33" opacity=".8" />
          <rect x="8" y="26" width="47" height="58" rx="5" fill="#fff" />
          <rect x="58" y="26" width="47" height="58" rx="5" fill="#fff" />
          <rect x="108" y="26" width="44" height="28" rx="5" fill="#fff" />
          <rect x="108" y="57" width="44" height="27" rx="5" fill="#fff" />
          {[0, 1, 2, 3].map((i) => (
            <g>
              <rect x="12" y={32 + i * 12} width="2" height="8" rx="1" fill={['#4c8dff', '#ff9f1c', '#2ec4b6', '#9b5de5'][i]} />
              <rect x="17" y={33 + i * 12} width={30 - (i % 2) * 8} height="3" rx="1.5" fill="#2b2b33" opacity=".55" />
            </g>
          ))}
          {['#ff8fab', '#7cc6fe', '#9be3a0', '#ffc46b'].map((c, i) => (
            <g>
              <circle cx="65" cy={35 + i * 12} r="3.6" fill={c} opacity=".45" stroke={c} stroke-width="1" />
              <rect x="71" y={33 + i * 12} width="18" height="2.6" rx="1.3" fill="#2b2b33" opacity=".6" />
              <rect x="71" y={37.4 + i * 12} width="28" height="1.8" rx=".9" fill="#000" opacity=".07" />
              <rect x="71" y={37.4 + i * 12} width={[20, 9, 28, 14][i]} height="1.8" rx=".9" fill={c} />
            </g>
          ))}
          {[0, 1, 2].map((i) => (
            <rect x="112" y={32 + i * 7} width={30 - i * 5} height="3" rx="1.5" fill="#2b2b33" opacity=".5" />
          ))}
          {[0, 1, 2].map((i) => (
            <g>
              <circle cx="114" cy={64.5 + i * 6.5} r="1.8" fill="none" stroke="#2b2b33" stroke-opacity=".45" stroke-width=".8" />
              <rect x="118" y={63.3 + i * 6.5} width={24 - i * 4} height="2.4" rx="1.2" fill="#2b2b33" opacity=".45" />
            </g>
          ))}
        </g>
      )}
      {id === 'kidsMeals' && (
        <g>
          <rect width="160" height="90" rx="6" fill="#f6f3ee" />
          <rect x="8" y="7" width="26" height="8" rx="2" fill="#2b2b33" opacity=".8" />
          <rect x="38" y="9" width="34" height="3.5" rx="1.5" fill="#2b2b33" opacity=".35" />
          <rect x="120" y="7" width="32" height="8" rx="2.5" fill="#2b2b33" opacity=".15" />
          <rect x={22 + 2 * 19} y="20" width="18.4" height="64" rx="3" fill={accent} opacity=".14" />
          {[0, 1, 2, 3, 4, 5, 6].map((c) => (
            <rect x={24 + c * 19} y="23" width="12" height="3" rx="1.5" fill={c === 2 ? accent : '#2b2b33'} opacity={c === 2 ? 1 : 0.45} />
          ))}
          {[0, 1, 2].map((r) => (
            <g>
              <circle cx="14" cy={38 + r * 18} r="3.2" fill={['#ffc46b', '#9be3a0', '#c3a6ff'][r]} />
              {[0, 1, 2, 3, 4, 5, 6].map((c) => (
                <g>
                  <rect x={22.6 + c * 19} y={30 + r * 18} width="17.2" height="15.5" rx="2.5" fill="#fff" />
                  <rect x={25 + c * 19} y={35 + r * 18} width={(c + r) % 3 === 0 ? 9 : 12.4} height="2.4" rx="1.2" fill="#2b2b33" opacity=".5" />
                  {(c + r) % 2 === 0 && <rect x={25 + c * 19} y={39 + r * 18} width="8" height="2.4" rx="1.2" fill="#2b2b33" opacity=".35" />}
                </g>
              ))}
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

/**
 * The style cards of Diseño. 'kids' is not a stored style: it is the Modern style with one of the kids layouts
 * (screen.style 'modern' + layout.preset kidsRoutines / kidsFamily / kidsMeals), so older configs and the display
 * need nothing new. Picking it selects a kids layout; Moderno or Clásico go back to a normal one.
 */
export type StyleChoice = DisplayStyle | 'kids' | 'canvas';
export const STYLES: { id: StyleChoice; name: string; desc: string }[] = [
  { id: 'modern', name: 'Moderno', desc: 'Más minimalista, al estilo de Apple: tarjetas de cristal sobre la foto, reloj de pantalla de bloqueo y menos líneas.' },
  { id: 'classic', name: 'Clásico', desc: 'El aspecto de siempre: reloj fino, tarjetas con borde y la cuadrícula completa.' },
  { id: 'kids', name: 'Niños', desc: 'Colores suaves, rutinas con estrellas y el menú de la semana. Basado en el moderno.' },
  // Personalizado (screen.canvas, the builder): like Niños, the Modern style with its own layout ('canvas')
  { id: 'canvas', name: 'Personalizado', desc: 'Coloca tú los widgets en una cuadrícula: relojes, calendarios, el tiempo, fotos y más, cada uno con su tamaño y su aspecto.' },
];

/** Style card shown as chosen for a screen. */
export const styleChoiceOf = (style: string | undefined, preset: string): StyleChoice =>
  isKidsPreset(preset) ? 'kids' : preset === 'canvas' ? 'canvas' : style === 'modern' ? 'modern' : 'classic';

/** Tiny drawing of the kids style: pastel cards with avatar circles, progress bars and check circles. */
function KidsStyleThumb() {
  const colors = ['#ff8fab', '#7cc6fe', '#9be3a0'];
  return (
    <svg viewBox="0 0 160 90" class="schematic" aria-hidden="true">
      <rect width="160" height="90" rx="6" fill="#f6f3ee" />
      <text x="9" y="21" fill="#2b2b33" font-size="15" font-weight="600" letter-spacing="-0.6" font-family="system-ui, sans-serif">
        9:41
      </text>
      <rect x="9" y="25" width="26" height="3" rx="1.5" fill="#2b2b33" opacity=".3" />
      <text x="118" y="20" font-size="10" font-family="system-ui, sans-serif">
        ⭐
      </text>
      <rect x="131" y="13" width="18" height="5" rx="2" fill="#f5a524" opacity=".85" />
      {colors.map((c, i) => (
        <g>
          <rect x={8 + i * 49} y="34" width="45" height="50" rx="7" fill="#fff" />
          <circle cx={19 + i * 49} cy="45" r="6" fill={c} opacity=".35" stroke={c} stroke-width="1.6" />
          <rect x={28 + i * 49} y="42.5" width="18" height="4" rx="2" fill="#2b2b33" opacity=".7" />
          <rect x={13 + i * 49} y="55" width="35" height="3" rx="1.5" fill="#000" opacity=".07" />
          <rect x={13 + i * 49} y="55" width={[26, 12, 35][i]} height="3" rx="1.5" fill={c} />
          {[0, 1].map((j) => (
            <g>
              <rect x={13 + i * 49} y={62 + j * 10} width="35" height="8" rx="3" fill={c} opacity=".2" />
              <circle cx={43 + i * 49} cy={66 + j * 10} r="2.6" fill={(i + j) % 2 ? 'none' : c} stroke={c} stroke-width="1.1" />
              <rect x={16 + i * 49} y={64.8 + j * 10} width={16 - j * 4} height="2.4" rx="1.2" fill="#2b2b33" opacity=".5" />
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

/** Tiny drawing of each display style (same scene: photo with clock + widgets, calendar on the right). */
export function StyleThumb({ id }: { id: StyleChoice }) {
  if (id === 'kids') return <KidsStyleThumb />;
  if (id === 'canvas') return <CanvasStyleThumb />;
  const modern = id === 'modern';
  const accent = 'var(--accent)';
  const rows = [0, 1, 2, 3];
  const cols = [0, 1, 2, 3, 4, 5, 6];
  return (
    <svg viewBox="0 0 160 90" class="schematic" aria-hidden="true">
      <defs>
        <linearGradient id={`st-ph-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2b3d63" />
          <stop offset="0.55" stop-color="#7a4b63" />
          <stop offset="1" stop-color="#d0875e" />
        </linearGradient>
      </defs>
      <rect width="160" height="90" rx="6" fill="#0d0e12" />
      <path d="M6 0 H58 V90 H6 a6 6 0 0 1 -6 -6 V6 a6 6 0 0 1 6 -6z" fill={`url(#st-ph-${id})`} />
      <text x={modern ? 8 : 9} y="22" fill="#fff" font-size="15" font-weight={modern ? 600 : 200} letter-spacing={modern ? -0.6 : 0} font-family="system-ui, sans-serif">
        9:41
      </text>
      {modern ? (
        <g>
          <rect x="6" y="40" width="46" height="18" rx="5" fill="#fff" fill-opacity=".2" stroke="#fff" stroke-opacity=".45" stroke-width=".6" />
          <rect x="10" y="45" width="5" height="5" rx="1.4" fill={accent} opacity=".85" />
          <rect x="18" y="46" width="22" height="3" rx="1.5" fill="#fff" opacity=".85" />
          <rect x="6" y="62" width="46" height="22" rx="6" fill="#fff" fill-opacity=".2" stroke="#fff" stroke-opacity=".45" stroke-width=".6" />
          <text x="10" y="76" fill="#fff" font-size="9" font-weight="300" font-family="system-ui, sans-serif">19°</text>
        </g>
      ) : (
        <g>
          <rect x="6" y="40" width="46" height="9" rx="4.5" fill="#000" fill-opacity=".45" stroke={accent} stroke-width=".7" />
          <rect x="6" y="51" width="46" height="9" rx="4.5" fill="#000" fill-opacity=".45" stroke="#2ec4b6" stroke-width=".7" />
          <rect x="6" y="64" width="46" height="20" rx="4" fill="#000" fill-opacity=".5" stroke="#fff" stroke-opacity=".25" stroke-width=".6" />
          <text x="10" y="78" fill="#fff" font-size="10" font-weight="200" font-family="system-ui, sans-serif">19°</text>
        </g>
      )}
      <rect x="64" y="7" width={modern ? 30 : 26} height="5" rx="1.5" fill="#fff" opacity={modern ? 0.95 : 0.75} />
      {rows.map((r) => (
        <g>
          <rect x="64" y={18 + r * 17.5} width="90" height=".5" fill="#fff" opacity={modern ? 0.18 : 0.14} />
          {cols.map((c) => (
            <g>
              {!modern && c > 0 && <rect x={64 + c * 12.9} y={18 + r * 17.5} width=".5" height="17.5" fill="#fff" opacity=".14" />}
              {modern && r === 1 && c === 3 ? (
                <circle cx={64 + c * 12.9 + 4.5} cy={18 + r * 17.5 + 4.5} r="3.2" fill={accent} />
              ) : (
                <rect x={64 + c * 12.9 + 2} y={18 + r * 17.5 + 2.5} width="5" height="2.4" rx=".8" fill="#fff" opacity={modern ? 0.7 : 0.45} />
              )}
              {!modern && r === 1 && c === 3 && (
                <rect x={64 + c * 12.9 + 0.6} y={18 + r * 17.5 + 0.6} width="11.7" height="16.3" rx="1.5" fill="none" stroke={accent} stroke-width=".8" />
              )}
            </g>
          ))}
          {r !== 2 && (
            <rect
              x={64 + (r % 2) * 25 + 1}
              y={18 + r * 17.5 + 9}
              width={modern ? 36 : 50}
              height="4"
              rx={modern ? 1.6 : 1}
              fill={['#4c8dff', '#2ec4b6', '', '#f15bb5'][r]}
              opacity={modern ? 0.45 : 0.95}
            />
          )}
        </g>
      ))}
    </svg>
  );
}

/** The two sample photos of the glass preview (a dark dusk and a bright beach), with their measured stats. */
const GLASS_SCENES: { id: string; label: string; stats: PhotoStats }[] = [
  { id: 'dark', label: 'Foto oscura', stats: { tone: 0.18, rgb: [92, 70, 128] } },
  { id: 'bright', label: 'Foto clara', stats: { tone: 0.85, rgb: [70, 150, 190] } },
];

/** Live preview of the glass settings: the same maths as the screen, drawn over two sample photos. */
export function GlassPreview({ glass }: { glass: GlassConfig }) {
  return (
    <div class="glass-pv" aria-hidden="true">
      {GLASS_SCENES.map((sc) => {
        const g = glassVars(glass, sc.stats, { lite: false, hasPhoto: true });
        const v = g.vars;
        const blur = normalizeGlass(glass).blur;
        const style = {
          '--pv-bg': `rgb(${v['--g-rgb']} / ${v['--g-a']})`,
          '--pv-filter': blur > 0 ? `blur(${(blur * 0.45).toFixed(1)}px) saturate(${v['--g-filter'].match(/saturate\(([\d.]+)\)/)?.[1] ?? '1.8'})` : 'none',
          '--g-edge': v['--g-edge'],
        } as Record<string, string>;
        return (
          <div class={`glass-pv__scene glass-pv__scene--${sc.id}`}>
            <div class="glass-pv__sun" />
            <div class="glass-pv__hill" />
            <div class={`glass-pv__card ${g.inkDark ? 'is-ink-dark' : ''} ${g.thin ? 'is-thin' : ''} ${g.edge ? 'has-edge' : ''}`} style={style}>
              <div class="glass-pv__row">
                <span class="glass-pv__loc">Lisboa</span>
                <span class="glass-pv__temp">19°</span>
              </div>
              <div class="glass-pv__ev">
                <i />
                <span>17:30</span>
              </div>
            </div>
            <span class="glass-pv__label">{t(sc.label)}</span>
          </div>
        );
      })}
    </div>
  );
}

const opacityWord = (v: number) =>
  v < 0.2 ? 'Muy transparente' : v < 0.42 ? 'Más transparente' : v <= 0.58 ? 'Equilibrado' : v <= 0.8 ? 'Más sólido' : 'Muy sólido';

/** Glass options of the Modern style (like the iPhone's Liquid Glass settings). */
export function GlassCard({ cfg, set, title }: Pick<SectionProps, 'cfg' | 'set'> & { title?: string }) {
  const g = normalizeGlass(cfg.screen.glass);
  const put = <K extends keyof GlassConfig>(k: K, v: GlassConfig[K]) =>
    set((d) => void (d.screen.glass = { ...normalizeGlass(d.screen.glass), [k]: v }));
  // Personalizado (the card with a title) has its own, lighter default glass
  const defaults: GlassConfig = cfg.layout.preset === 'canvas' ? CANVAS_GLASS_DEFAULTS : GLASS_DEFAULTS;
  const isDefault = (Object.keys(defaults) as (keyof GlassConfig)[]).every((k) => g[k] === defaults[k]);
  return (
    <Card
      id="layout-glass"
      scope="screen"
      title={t(title ?? 'Cristal')}
      icon="sparkles"
      desc={title ? t('El cristal de las tarjetas que no tienen su propio estilo.') : t('Cómo se ven las tarjetas de cristal del estilo Moderno en esta pantalla.')}
      actions={
        <Button size="sm" variant="ghost" disabled={isDefault} onClick={() => set((d) => void (d.screen.glass = { ...defaults }))}>
          {t('Restablecer')}
        </Button>
      }
    >
      <div class="glass-set">
        <GlassPreview glass={g} />
        <div class="glass-set__controls">
          <Field label={t('Apariencia')} hint={t('Automático se adapta a cada foto: más transparente sobre fotos oscuras, más tintado sobre fotos claras.')}>
            <Segmented
              value={g.appearance}
              full
              options={[
                { value: 'clear', label: t('Transparente') },
                { value: 'tinted', label: t('Tintado') },
                { value: 'auto', label: t('Automático') },
              ]}
              onChange={(v) => put('appearance', v)}
            />
          </Field>
          <Field label={t('Transparencia')}>
            <Slider value={g.opacity} min={0} max={1} step={0.05} format={(v) => t(opacityWord(v))} onChange={(v) => put('opacity', v)} />
          </Field>
          <Field label={t('Desenfoque')} hint={t('En la Raspberry Pi (modo ligero) no hay desenfoque y las tarjetas son sólidas.')}>
            <Slider value={g.blur} min={0} max={40} step={1} format={(v) => (v ? `${v}` : t('Sin desenfoque'))} onChange={(v) => put('blur', v)} />
          </Field>
          <Field label={t('Tono')} hint={t('Con «De la foto», el cristal toma el color de la foto que se está mostrando, como en el iPhone.')}>
            <Segmented
              value={g.tint}
              full
              options={[
                { value: 'light', label: t('Claro') },
                { value: 'dark', label: t('Oscuro') },
                { value: 'photo', label: t('De la foto') },
              ]}
              onChange={(v) => put('tint', v)}
            />
          </Field>
          <ToggleRow label={t('Borde de luz')} hint={t('Una línea fina y brillante en el borde de cada tarjeta.')} checked={g.edge} onChange={(v) => put('edge', v)} />
        </div>
      </div>
    </Card>
  );
}

/**
 * Where the background photo goes (background.scope): the side area of the layout, or the whole screen with the
 * calendar over it as glass, and then how solid that glass is (background.calendarOpacity).
 */
export function PhotoScopeFields({ cfg, set, kids }: Pick<SectionProps, 'cfg' | 'set'> & { kids: boolean }) {
  const b = cfg.background;
  const scope: BackgroundScope = b.scope === 'screen' ? 'screen' : 'side';
  // Personalizado has its own background setting (screen.canvas.background)
  const applies = SCREEN_PHOTO_PRESETS.includes(cfg.layout.preset) && cfg.layout.preset !== 'canvas';
  const hint = !b.enabled
    ? t('Las fotos de fondo están desactivadas en esta pantalla.')
    : !applies
      ? t('Este diseño ya pone la foto en toda la pantalla, o no lleva foto.')
      : scope === 'screen'
        ? t('La foto llena toda la pantalla y el calendario se ve encima, como un cristal.')
        : kids
          ? t('Los diseños para niños solo llevan foto con “Toda la pantalla”.')
          : t('La foto solo se ve en la zona lateral del diseño.');
  return (
    <div id="layout-photo" class="stack">
      <Field label={t('Foto de fondo')} hint={hint}>
        <Segmented
          full
          value={scope}
          disabled={!b.enabled}
          options={[
            { value: 'side' as BackgroundScope, label: t('Solo el lateral') },
            { value: 'screen' as BackgroundScope, label: t('Toda la pantalla') },
          ]}
          onChange={(v) => set((d) => void (d.background.scope = v))}
        />
      </Field>
      {scope === 'screen' && b.enabled && applies && (
        <div class="grid grid--2">
          <Field label={t('Transparencia del calendario')}>
            <Slider
              value={b.calendarOpacity ?? CALENDAR_OPACITY_DEFAULT}
              min={0}
              max={1}
              step={0.05}
              format={(v) => t(opacityWord(v))}
              onChange={(v) => set((d) => void (d.background.calendarOpacity = v))}
            />
          </Field>
          <Field label={t('Desenfoque del calendario')}>
            <Slider
              value={b.calendarBlur ?? CALENDAR_BLUR_DEFAULT}
              min={0}
              max={40}
              step={1}
              format={(v) => (v ? `${v}` : t('Sin desenfoque'))}
              onChange={(v) => set((d) => void (d.background.calendarBlur = v))}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

/** Weather panel of the Classic style: blur and darkness behind it (background.panelBlur / panelShade). */
export function WeatherPanelCard({ cfg, set }: Pick<SectionProps, 'cfg' | 'set'>) {
  const b = cfg.background;
  return (
    <Card id="layout-weather-panel" scope="screen" title={t('Panel del tiempo')} icon="cloud" desc={t('Cómo se ve el panel del tiempo del estilo Clásico sobre la foto de fondo.')}>
      <div class="grid grid--2">
        <Field label={t('Desenfoque del panel del tiempo')} hint={t('0 = sin desenfoque. En la Raspberry Pi, menos desenfoque es más ligero.')}>
          <Slider value={b.panelBlur ?? 18} min={0} max={40} step={1} format={(v) => (v ? `${v}` : t('Sin desenfoque'))} onChange={(v) => set((d) => void (d.background.panelBlur = v))} />
        </Field>
        <Field label={t('Oscuridad del panel del tiempo')} hint={t('Más oscuro = más legible sobre fotos claras.')}>
          <Slider value={b.panelShade ?? 0.5} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.background.panelShade = v))} />
        </Field>
      </div>
    </Card>
  );
}

/** Planner: where the clock and the weather go on a landscape screen (layout.plannerBar). */
const PLANNER_BARS: { value: PlannerBar; label: string }[] = [
  { value: 'side', label: 'Al lado' },
  { value: 'top', label: 'Arriba' },
  { value: 'bottom', label: 'Abajo' },
];

const CORNERS: { value: FrameCorner; label: string }[] = [
  { value: 'tl', label: 'Arriba izquierda' },
  { value: 'tr', label: 'Arriba derecha' },
  { value: 'bl', label: 'Abajo izquierda' },
  { value: 'br', label: 'Abajo derecha' },
];

const SIZES: { value: WidgetPlacement['size']; label: string }[] = [
  { value: 's', label: 'Pequeño' },
  { value: 'm', label: 'Mediano' },
  { value: 'l', label: 'Grande' },
];

/** 2x2 corner picker (top-left, top-right, bottom-left, bottom-right). */
function CornerPick({ value, onChange }: { value: FrameCorner; onChange: (v: FrameCorner) => void }) {
  return (
    <div class="corner-pick" role="radiogroup" aria-label={t('Esquina')}>
      {CORNERS.map((c) => (
        <button type="button" role="radio" aria-checked={value === c.value} class={value === c.value ? 'is-on' : ''} title={t(c.label)} onClick={() => onChange(c.value)} />
      ))}
    </div>
  );
}

/** Widgets on this screen: which ones, where (corner or side column), how big, in what order. */
export function ScreenWidgetsCard({ cfg, set, full, go }: Pick<SectionProps, 'cfg' | 'set' | 'full' | 'go'>) {
  const defs = full.widgets ?? [];
  const rows = cfg.widgets ?? [];
  const placed = new Set(rows.map((p) => p.widgetId));
  const free = defs.filter((w) => !placed.has(w.id));
  const nameOf = (id: string) => defs.find((w) => w.id === id)?.name.trim() || t('Widget sin nombre');
  const upd = (i: number, fn: (p: WidgetPlacement) => void) =>
    set((d) => {
      const p = d.widgets?.[i];
      if (p) fn(p);
    });
  const add = () =>
    set((d) => {
      const next = defs.find((w) => !(d.widgets ?? []).some((p) => p.widgetId === w.id));
      if (!next) return;
      d.widgets = [...(d.widgets ?? []), { widgetId: next.id, place: 'corner', corner: 'br', size: 'm' }];
    });
  return (
    <Card
      id="layout-widgets"
      scope="screen"
      title={t('Widgets en esta pantalla')}
      icon="widget"
      desc={t('Imágenes y páginas de la sección Widgets, en una esquina o en la columna lateral. El primero va más cerca de la esquina.')}
      actions={
        defs.length > 0 && (
          <Button size="sm" variant="primary" icon="plus" disabled={!free.length || rows.length >= MAX_SCREEN_WIDGETS} onClick={add}>
            {t('Añadir a esta pantalla')}
          </Button>
        )
      }
    >
      {defs.length === 0 ? (
        <p class="muted small">
          {t('Aún no hay widgets.')}{' '}
          <button type="button" class="link-btn" onClick={() => go('widgets')}>
            {t('Crear un widget')}
          </button>
        </p>
      ) : rows.length === 0 ? (
        <p class="muted small">{t('Ningún widget en esta pantalla.')}</p>
      ) : (
        <div class="widget-rows">
          {rows.map((p, i) => (
            <div class="widget-row" key={p.widgetId}>
              <Select
                value={p.widgetId}
                options={[{ value: p.widgetId, label: nameOf(p.widgetId) }, ...free.map((w) => ({ value: w.id, label: w.name.trim() || t('Widget sin nombre') }))]}
                onChange={(v) => upd(i, (x) => void (x.widgetId = v))}
              />
              <Segmented
                value={p.place}
                options={[
                  { value: 'corner', label: t('Esquina') },
                  { value: 'side', label: t('Lateral') },
                ]}
                onChange={(v) => upd(i, (x) => void (x.place = v))}
              />
              <CornerPick value={p.corner} onChange={(v) => upd(i, (x) => void (x.corner = v))} />
              <Segmented value={p.size} options={SIZES.map((o) => ({ value: o.value, label: t(o.label) }))} onChange={(v) => upd(i, (x) => void (x.size = v))} />
              <div class="row-actions">
                <ReorderButtons index={i} count={rows.length} onMove={(a, b) => set((d) => void (d.widgets = moveItem(d.widgets ?? [], a, b)))} />
                <button type="button" class="icon-btn icon-btn--danger" aria-label={t('Quitar')} onClick={() => set((d) => void (d.widgets = (d.widgets ?? []).filter((x) => x.widgetId !== p.widgetId)))}>
                  <Icon name="x" size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {rows.some((p) => p.place === 'side') && <p class="muted small">{t('Si este diseño no tiene columna lateral, va a la esquina elegida.')}</p>}
      {rows.length > 0 && <p class="muted small">{t('En modo privado los widgets no se muestran.')}</p>}
    </Card>
  );
}

/** Settings of the layouts that have any: the people columns (Por persona) and the corner (Marco de fotos). */
function PresetOptions({ cfg, set, full, go }: SectionProps) {
  const l = cfg.layout;
  if (isKidsPreset(l.preset)) {
    return (
      <Card
        id="layout-options"
        scope="screen"
        title={t('Familia en esta pantalla')}
        icon="users"
        desc={
          <>
            {t('Los miembros, las rutinas y el enlace familiar se configuran en')}{' '}
            <button type="button" class="link-btn" onClick={() => go('family')}>
              {t('Familia')}
            </button>
            .
          </>
        }
      >
        <FamilyScreenOptions cfg={cfg} set={set} compact />
      </Card>
    );
  }
  if (l.preset === 'photoFrame') {
    return (
      <Card id="layout-options" scope="screen" title={t('Marco de fotos')} icon="image" desc={t('Dónde va la tarjeta con la hora, la temperatura y el próximo evento.')}>
        <Field label={t('Esquina')}>
          <Segmented full value={l.corner ?? 'br'} options={CORNERS.map((c) => ({ value: c.value, label: t(c.label) }))} onChange={(v) => set((d) => void (d.layout.corner = v))} />
        </Field>
      </Card>
    );
  }
  if (l.preset === 'widget') {
    const defs = full.widgets ?? [];
    return (
      <Card
        id="layout-options"
        scope="screen"
        title={t('Widget a pantalla completa')}
        icon="widget"
        desc={t('La imagen o la página ocupa la pantalla entera. Con «Completa» la foto de fondo se ve alrededor; con «Rellenar» la cubre.')}
      >
        {defs.length ? (
          <Field label={t('Widget')}>
            <Select
              value={l.widgetId ?? ''}
              options={[{ value: '', label: t('Ninguno') }, ...defs.map((w) => ({ value: w.id, label: w.name.trim() || t('Widget sin nombre') }))]}
              onChange={(v) => set((d) => void (d.layout.widgetId = v || null))}
            />
          </Field>
        ) : (
          <p class="muted small">
            {t('Aún no hay widgets.')}{' '}
            <button type="button" class="link-btn" onClick={() => go('widgets')}>
              {t('Crear un widget')}
            </button>
          </p>
        )}
        {defs.length > 0 && !l.widgetId && <Callout kind="warn">{t('Elige qué widget se ve: hasta entonces la pantalla muestra un aviso.')}</Callout>}
      </Card>
    );
  }
  if (l.preset === 'planner') {
    return (
      <Card
        id="layout-options"
        scope="screen"
        title={t('Planificador')}
        icon="calendar"
        desc={t('Al elegirlo se activan las semanas automáticas y las tarjetas. Puedes cambiarlo aquí o en Calendarios, Vista del calendario.')}
      >
        <div class="grid grid--2">
          <WeeksField cfg={cfg} set={set} />
          <EventStyleField cfg={cfg} set={set} />
        </div>
        <Field
          label={t('Hora y tiempo')}
          hint={t('En pantallas horizontales. Arriba o abajo, el mes ocupa todo el ancho y el tiempo se ve en una fila. En vertical siempre van arriba.')}
        >
          <Segmented
            full
            value={l.plannerBar ?? 'side'}
            options={PLANNER_BARS.map((o) => ({ value: o.value, label: t(o.label) }))}
            onChange={(v) =>
              set((d) => {
                d.layout.plannerBar = v;
                // the strip leaves room for 4 weeks at most: 5 or 6 become 4 (back at the side they stay 4)
                const cap = weeksCap(d);
                if (cap && typeof d.calendar.weeks === 'number' && d.calendar.weeks > cap) d.calendar.weeks = cap;
              })
            }
          />
        </Field>
      </Card>
    );
  }
  if (l.preset !== 'people') return null;
  const opts = allSourceOptions(full, { includeDisabled: false }).filter((o) => o.id !== 'birthdays');
  const holidays = new Set(full.calendar.sources.filter((x) => x.kind === 'holidays').map((x) => x.id));
  const auto = !Array.isArray(l.people);
  const ids = l.people ?? [];
  const full5 = ids.length >= 5;
  const toggle = (id: string, on: boolean) =>
    set((d) => {
      const cur = d.layout.people ?? [];
      const next = new Set(on ? [...cur, id] : cur.filter((x) => x !== id));
      d.layout.people = opts.map((o) => o.id).filter((x) => next.has(x)).slice(0, 5);
    });
  return (
    <Card id="layout-options" scope="screen" title={t('Columnas por persona')} icon="list" desc={t('Cada calendario elegido es una columna con lo de hoy y lo de mañana. Festivos y cumpleaños van en una línea común encima.')}>
      <Segmented
        full
        value={auto ? 'auto' : 'pick'}
        options={[
          { value: 'auto', label: t('Automático') },
          { value: 'pick', label: t('Elegir calendarios') },
        ]}
        onChange={(v) => set((d) => void (d.layout.people = v === 'auto' ? null : opts.filter((o) => !holidays.has(o.id)).slice(0, 5).map((o) => o.id)))}
      />
      {auto ? (
        <p class="muted small">{t('Se usan los primeros cinco calendarios, sin festivos ni cumpleaños.')}</p>
      ) : (
        <>
          <ul class="gcal-list screen-src-list">
            {opts.map((o) => {
              const on = ids.includes(o.id);
              return (
                <li>
                  <label class={`gcal ${on ? 'is-on' : ''} ${!on && full5 ? 'is-dim' : ''}`}>
                    <input type="checkbox" checked={on} disabled={!on && full5} onChange={(e) => toggle(o.id, e.currentTarget.checked)} />
                    <span class="check-box">
                      <Icon name="check" size={12} />
                    </span>
                    <span class="dot-color" style={{ background: o.color }} />
                    <span class="gcal__name">
                      {o.emoji ? `${o.emoji} ` : ''}
                      {o.name}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p class="muted small">{t('Hasta cinco columnas. Se ven en el orden de esta lista.')}</p>
          {ids.length === 0 && <Callout kind="warn">{t('No has marcado ningún calendario: la pantalla pedirá que elijas alguno.')}</Callout>}
        </>
      )}
    </Card>
  );
}

export function LayoutSection(props: SectionProps) {
  const { cfg, set } = props;
  const l = cfg.layout;
  // the planner has a side column on landscape screens, unless its clock and weather go in a strip above or below
  const plannerStrip = l.preset === 'planner' && (l.plannerBar ?? 'side') !== 'side';
  const hasSide = ['bigCalendar', 'leftRight', 'today', 'twoWeeks', 'planner'].includes(l.preset) && !plannerStrip;
  const style: DisplayStyle = cfg.screen.style === 'modern' ? 'modern' : 'classic';
  const choice = styleChoiceOf(cfg.screen.style, l.preset);
  const kids = choice === 'kids';
  const canvasOn = choice === 'canvas';
  // a server without Familia (features.family) offers no kids style, unless this screen already has one; the same
  // for Personalizado (features.screenBuilder)
  const styles = STYLES.filter((o) => (o.id !== 'kids' || kids || has('family')) && (o.id !== 'canvas' || canvasOn || has('screenBuilder')));
  // the normal layout to go back to when leaving Niños or Personalizado: the last one picked here on this screen, else
  // the saved one, else the big calendar (the page stays mounted when another screen is picked, so it is kept per screen)
  const lastNormal = useRef(new Map<string, LayoutPreset>());
  const isSpecial = (p: string | undefined) => !!p && (isKidsPreset(p) || p === 'canvas');
  if (!isSpecial(l.preset)) lastNormal.current.set(props.screenId, l.preset);
  const savedPreset = props.saved.screens.find((s) => s.id === props.screenId)?.layout.preset;
  // the design "Copiar mi diseño actual" copies onto the grid
  const copyFrom: LayoutPreset | null = lastNormal.current.get(props.screenId) ?? (savedPreset && savedPreset !== 'canvas' ? savedPreset : null);
  // the builder (web/admin/builder/), loaded the first time it opens
  const [builder, setBuilder] = useState<{ C: ComponentType<any>; templates: boolean } | null>(null);
  const openBuilder = (templates: boolean) =>
    import('../builder/BuilderModal')
      .then((m) => setBuilder({ C: m.BuilderModal, templates }))
      .catch((e) => console.warn('[builder] load', e));
  // the page closes the editor when another screen is picked
  useEffect(() => setBuilder(null), [props.screenId]);
  const pickStyle = (v: StyleChoice) => {
    if (v === 'canvas') {
      const empty = !(cfg.canvas?.items?.length);
      set((d) => {
        d.screen.style = 'modern';
        if (d.layout.preset === 'canvas') return;
        if (d.layout.preset === 'planner') {
          const was = props.saved.screens.find((s) => s.id === props.screenId);
          if (was && was.layout.preset !== 'planner') undoPlannerPick(d.calendar, was.calendar);
        }
        // the first time, an untouched glass becomes the lighter one of Personalizado
        startCanvasGlass(d);
        d.layout.preset = 'canvas';
        d.canvas ??= defaultCanvas();
      });
      // an empty grid starts with the templates
      if (choice !== 'canvas' || empty) void openBuilder(empty);
      return;
    }
    set((d) => {
      if (v === 'kids') {
        // the kids layouts are drawn with the Modern style underneath
        d.screen.style = 'modern';
        if (!isKidsPreset(d.layout.preset)) {
          if (d.layout.preset === 'planner') {
            const was = props.saved.screens.find((s) => s.id === props.screenId);
            if (was && was.layout.preset !== 'planner') undoPlannerPick(d.calendar, was.calendar);
          }
          d.layout.preset = 'kidsFamily';
          // the kids layouts are made for a light page; the theme is right below if they want it dark
          d.screen.theme = 'light';
        }
        return;
      }
      d.screen.style = v;
      if (isSpecial(d.layout.preset)) {
        const back = lastNormal.current.get(props.screenId) ?? (savedPreset && !isSpecial(savedPreset) ? savedPreset : 'bigCalendar');
        // back to the planner: what it is made for comes back too (entering Niños took it away, see above)
        if (back === 'planner' && savedPreset !== 'planner') Object.assign(d.calendar, PLANNER_CALENDAR);
        d.layout.preset = back;
      }
    });
  };
  return (
    <>
      <PageHeader title={t('Diseño')} scope="screen" desc={t('Elige cómo se distribuyen los elementos en la pantalla.')} />
      <Card
        id="layout-style"
        scope="screen"
        title={t('Estilo de la pantalla')}
        icon="palette"
        desc={t('Independiente de la plantilla: cada pantalla puede tener su propio estilo.')}
      >
        <Field label={t('Estilo')} class={styles.length > 3 ? 'style-field--4' : undefined}>
          <Segmented value={choice} options={styles.map((o) => ({ value: o.id, label: t(o.name) }))} onChange={pickStyle} />
        </Field>
        <div class={`preset-grid style-grid ${styles.length > 3 ? 'style-grid--4' : ''}`} id="layout-kids">
          {styles.map((o) => (
            <button type="button" class={`preset ${choice === o.id ? 'is-active' : ''}`} onClick={() => pickStyle(o.id)} aria-pressed={choice === o.id}>
              <StyleThumb id={o.id} />
              <div class="preset__text">
                <div class="preset__name">
                  <span class="radio-dot" />
                  {t(o.name)}
                </div>
                <p>{t(o.desc)}</p>
              </div>
            </button>
          ))}
        </div>
        {kids && style !== 'modern' && (
          <Callout kind="warn">
            {t('Estos diseños solo funcionan con el estilo Moderno.')}{' '}
            <Button size="sm" variant="primary" onClick={() => set((d) => void (d.screen.style = 'modern'))}>
              {t('Cambiar a Moderno')}
            </Button>
          </Callout>
        )}
      </Card>
      <Card id="layout-look" scope="screen" title={t('Apariencia')} icon="palette">
        <div class="grid grid--2">
          <Field label={t('Tema')}>
            <Segmented
              full
              value={cfg.screen.theme}
              options={[
                { value: 'dark', label: t('Oscuro'), icon: 'moon' },
                { value: 'light', label: t('Claro'), icon: 'sun' },
              ]}
              onChange={(v) => set((d) => void (d.screen.theme = v))}
            />
          </Field>
          <Field label={t('Color de acento')} error={props.errors['screen.accent']}>
            <ColorPicker value={cfg.screen.accent} error={!!props.errors['screen.accent']} onChange={(v) => v && set((d) => void (d.screen.accent = v))} />
          </Field>
        </div>
        <PhotoScopeFields cfg={cfg} set={set} kids={kids} />
        {!canvasOn && !kids && (
          <ToggleRow
            label={t('Avisos bajo la fecha')}
            hint={t('El próximo evento, los cumpleaños y las entradas y salidas de hoy.')}
            checked={cfg.screen.highlights !== false}
            onChange={(v) => set((d) => void (d.screen.highlights = v))}
          />
        )}
        {!canvasOn && !kids && has('spotify') && (
          <Field label={t('Sonando ahora bajo el reloj')} hint={t('Una línea con la canción que suena en esa cuenta de Spotify. Si no suena nada, no se ve.')}>
            <SpotifyAccountSelect value={cfg.screen.nowPlaying ?? ''} none="No mostrar" go={props.go} onChange={(v) => set((d) => {
              if (v) d.screen.nowPlaying = v;
              else delete d.screen.nowPlaying;
            })} />
          </Field>
        )}
      </Card>
      {canvasOn && <CanvasCard cfg={cfg} onOpen={() => void openBuilder(!(cfg.canvas?.items?.length))} />}
      {!kids && (canvasOn ? <GlassCard cfg={cfg} set={set} title="Estilo por defecto de las tarjetas" /> : style === 'modern' ? <GlassCard cfg={cfg} set={set} /> : <WeatherPanelCard cfg={cfg} set={set} />)}
      {builder && <builder.C {...props} onClose={() => setBuilder(null)} startWithTemplates={builder.templates} copyFrom={copyFrom} />}
      {!canvasOn && (
      <>
      {kids && !cfg.family.enabled && (
        <Callout>
          {t('Activa la familia en la sección Familia para ver rutinas.')}{' '}
          <button type="button" class="link-btn" onClick={() => props.go('family')}>
            {t('Ir a Familia')}
          </button>
        </Callout>
      )}
      <div class="preset-grid" id="layout-presets">
        {PRESETS.filter((p) => kids === (p.group === 'kids') && (p.id !== 'widget' || has('widgets') || l.preset === 'widget') && (p.id !== 'canvas' || l.preset === 'canvas')).map((p) => (
          <button
            type="button"
            class={`preset ${l.preset === p.id ? 'is-active' : ''}`}
            onClick={() =>
              set((d) => {
                // picking the planner also turns on what it is made for (automatic weeks, cards); both can be changed later
                if (p.id === 'planner' && d.layout.preset !== 'planner') {
                  Object.assign(d.calendar, PLANNER_CALENDAR);
                  // the time and the weather start in the strip on top (a portrait screen ignores it)
                  d.layout.plannerBar = 'top';
                }
                // leaving it before saving takes that back, so the other layouts keep the weeks and style they had
                else if (p.id !== 'planner' && d.layout.preset === 'planner') {
                  const was = props.saved.screens.find((s) => s.id === props.screenId);
                  if (was && was.layout.preset !== 'planner') undoPlannerPick(d.calendar, was.calendar);
                }
                d.layout.preset = p.id;
              })
            }
            aria-pressed={l.preset === p.id}
          >
            <Schematic id={p.id} side={l.sidePanel} plannerBar={l.plannerBar ?? 'side'} />
            <div class="preset__text">
              <div class="preset__name">
                <span class="radio-dot" />
                {t(p.name)}
              </div>
              <p>{t(p.desc)}</p>
            </div>
          </button>
        ))}
      </div>
      <PresetOptions {...props} />
      {has('widgets') && <ScreenWidgetsCard cfg={cfg} set={set} full={props.full} go={props.go} />}
      <Card
        id="layout-side"
        scope="screen"
        title={t('Panel lateral')}
        icon="layout"
        desc={plannerStrip ? t('El Planificador tiene ahora la hora y el tiempo arriba o abajo, sin columna lateral.') : t('Solo para los diseños con columna lateral.')}
        muted={!hasSide}
      >
        <div class="grid grid--2">
          <Field label={t('Posición')}>
            <Segmented
              value={l.sidePanel}
              disabled={!hasSide}
              options={[
                { value: 'left', label: t('Izquierda') },
                { value: 'right', label: t('Derecha') },
              ]}
              onChange={(v) => set((d) => void (d.layout.sidePanel = v))}
            />
          </Field>
          <Field label={t('Anchura')}>
            <Slider
              value={l.sideWidth}
              min={0.22}
              max={0.5}
              step={0.01}
              disabled={!hasSide}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => set((d) => void (d.layout.sideWidth = v))}
            />
          </Field>
        </div>
      </Card>
      </>
      )}
    </>
  );
}

/** Personalizado: a drawing of the saved layout, what it holds, and the button that opens the editor. */
function CanvasCard({ cfg, onOpen }: { cfg: SectionProps['cfg']; onOpen: () => void }) {
  const cv: CanvasConfig = cfg.canvas ?? defaultCanvas();
  const n = canvasCards(cv.items).length;
  const side = { none: 'sin barra lateral', left: 'barra lateral a la izquierda', right: 'barra lateral a la derecha', top: 'barra lateral arriba', bottom: 'barra lateral abajo' }[cv.sidebar.side];
  const bg = { photo: 'foto', ambient: 'animado', solid: 'color' }[cv.background];
  return (
    <Card id="layout-canvas" scope="screen" title={t('Personalizado')} icon="layout" desc={t('Los widgets de esta pantalla, colocados por ti.')}>
      <div class="canvas-card">
        <button type="button" class="canvas-card__thumb" onClick={onOpen} aria-label={t('Abrir editor')}>
          <CanvasThumb cv={cv} portrait={cfg.screen.orientation === 'portrait'} light={cfg.screen.theme === 'light'} />
        </button>
        <div class="canvas-card__text">
          <p>
            {n ? t('{n} widgets', { n }) : t('Todavía no hay widgets')} · {t(side)} · {t('fondo')}: {t(bg)}
          </p>
          <Button variant="primary" icon="edit" onClick={onOpen}>
            {t('Abrir editor')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
