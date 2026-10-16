// The builder's preview of Home Assistant cards that are not saved yet: the display in the frame only gets states for
// saved items from the server, so the builder fetches the slim states of the draft's entities (POST
// /api/admin/homeassistant/slim) and the chart points (GET /api/admin/homeassistant/history), keys them by the same
// aliases the server would use (canvasCore itemAliases) and Stage.tsx posts them to the frame ('marco:preview-ha',
// 'marco:preview-history'). Refreshed every 15 s while the editor is open. Camera cards get one picture every 10 s
// (GET /api/admin/homeassistant/camera, 'marco:preview-camera'): the preview never opens a live picture.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CanvasConfig, HaControl, HaHistory, HaSlim, HaState, HaStatistic, TileFeature } from '../../shared/types';
import { itemAliases, itemNames, needsConfirm, canvasCards } from '../../../server/core/canvasCore.js';
import { controlsFor, tileFeatures } from '../../../server/core/haCore.js';
import { attrsFromSlim } from '../../shared/haGuess';

/**
 * The controls a card would offer for a slim state, worked out again from what the slim state says (the builder has
 * no attributes): only so the frame draws them as the screen will (the preview never sends an action).
 */
function guessControls(kind: string, entity: string, s: HaSlim, props: Record<string, unknown>): HaControl[] {
  return controlsFor(kind, entity.split('.')[0], attrsFromSlim(s), props);
}

/** The rows under an Entidad card for a slim state, as the server would give them. */
function guessFeatures(entity: string, s: HaSlim, props: Record<string, unknown>): TileFeature[] {
  return tileFeatures(entity.split('.')[0], attrsFromSlim(s), props);
}
import { api } from '../api';

const REFRESH_MS = 15_000;

export interface HaPreview {
  states: Record<string, HaState>;
  history: Record<string, HaHistory>;
  /** the value of each Estadística card, by item id */
  stats: Record<string, HaStatistic>;
  /** the raw state of each entity the draft binds or its conditions read ("Mostrar solo si"), by entity id */
  raw: Record<string, string>;
  /** the latest picture of each camera card, by item id */
  frames: Record<string, Blob>;
}

const CAMERA_MS = 10_000;

/** One picture of a camera for the preview (null when it cannot be had now). */
async function cameraBlob(entity: string): Promise<Blob | null> {
  try {
    const r = await fetch(`/api/admin/homeassistant/camera?entity=${encodeURIComponent(entity)}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok || !/^image\/(jpeg|png|webp|gif)$/.test(r.headers.get('content-type') || '')) return null;
    return await r.blob();
  } catch {
    return null;
  }
}

/** Charts (and sensors with their curve) of the draft: item id → { entities, period, labels }. */
function chartsOf(cv: CanvasConfig) {
  const out: { id: string; entities: string[]; period: string; labels: string[] }[] = [];
  for (const it of canvasCards(cv.items)) {
    const p = it.props as Record<string, any>;
    if (it.kind === 'ha.chart') {
      const series = ((p.series ?? []) as { entity?: string; label?: string }[]).filter((s) => s.entity);
      if (series.length) out.push({ id: it.id, entities: series.map((s) => s.entity!), period: String(p.period || '24h'), labels: series.map((s) => s.label || '') });
    } else if (it.kind === 'ha.sensor' && p.sparkline && p.entity) {
      out.push({ id: it.id, entities: [p.entity], period: '24h', labels: [p.name || ''] });
    }
  }
  return out;
}

export function useHaPreview(cv: CanvasConfig, enabled: boolean): HaPreview | null {
  const aliases = useMemo(
    // the cards inside a Rotativa too (their own aliases; never touch controls)
    () => canvasCards(cv.items).flatMap((it) => {
      if (it.hidden) return [];
      const names = itemNames(it);
      return itemAliases(it).map((a) => ({ ...a, kind: it.kind, props: it.props, touch: cv.touch && it.interactive !== false, ack: !!it.ack, name: names[a.slot]?.name ?? '' }));
    }),
    [cv],
  );
  // the entities of the cards, then the ones their conditions read (the badge on the stage)
  const condEntities = useMemo(() => cv.items.flatMap((it) => (it.when?.src === 'ha' && it.when.entity && !it.hidden ? [it.when.entity] : [])), [cv]);
  const entities = useMemo(() => [...new Set([...aliases.map((a) => a.entity), ...condEntities])].sort().slice(0, 40), [aliases, condEntities]);
  const statItems = useMemo(
    () => canvasCards(cv.items).filter((it) => it.kind === 'ha.statistic' && !it.hidden && (it.props as { entity?: string }).entity).map((it) => {
      const p = it.props as { entity: string; stat?: string; period?: string };
      return { id: it.id, entity: p.entity, stat: p.stat || 'change', period: p.period || 'today' };
    }),
    [cv],
  );
  const [stats, setStats] = useState<Record<string, HaStatistic & { key: string }>>({});
  const charts = useMemo(() => chartsOf(cv), [cv]);
  const [slim, setSlim] = useState<Record<string, HaSlim & { at: number; st?: string }>>({});
  const [points, setPoints] = useState<Record<string, HaHistory & { key: string }>>({});
  const tick = useRef(0);
  const [beat, setBeat] = useState(0);
  const [frames, setFrames] = useState<Record<string, Blob>>({});
  // the camera cards of the draft: item id → entity (cards waiting for a sensor are shown too, dimmed)
  const cams = useMemo(
    () => canvasCards(cv.items).filter((it) => it.kind === 'ha.camera' && !it.hidden && typeof (it.props as { entity?: unknown }).entity === 'string' && (it.props as { entity: string }).entity).map((it) => ({ id: it.id, entity: (it.props as { entity: string }).entity })),
    [cv],
  );
  const camKey = JSON.stringify(cams);
  useEffect(() => {
    if (!enabled || !cams.length) return;
    let alive = true;
    const load = async () => {
      // one request per camera, even when several cards show it
      const byEntity = new Map<string, Promise<Blob | null>>();
      for (const c of cams) if (!byEntity.has(c.entity)) byEntity.set(c.entity, cameraBlob(c.entity));
      const next: Record<string, Blob> = {};
      for (const c of cams) {
        const b = await byEntity.get(c.entity)!;
        if (b) next[c.id] = b;
      }
      if (alive) setFrames(next);
    };
    void load();
    const id = window.setInterval(() => void load(), CAMERA_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [camKey, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setBeat((b) => b + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled]);

  // the states of every entity the draft binds
  const ekey = entities.join(',');
  useEffect(() => {
    if (!enabled || !entities.length) return;
    const n = ++tick.current;
    const t = window.setTimeout(() => {
      api.haSlim(entities).then((r) => {
        if (n === tick.current) setSlim(r.states ?? {});
      }, () => undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [ekey, enabled, beat]);

  // the points of each chart, again when its entities or period change (the server caches them)
  const ckey = JSON.stringify(charts.map((c) => [c.id, c.entities, c.period]));
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    for (const c of charts) {
      const key = `${c.entities.join(',')}|${c.period}`;
      if (points[c.id]?.key === key && beat % 8 !== 0) continue;
      api.haHistory(c.entities, c.period).then((h) => {
        if (!alive) return;
        setPoints((old) => ({ ...old, [c.id]: { key, period: h.period, series: h.series.map((s) => ({ label: s.label, unit: s.unit, points: s.points })) } }));
      }, () => undefined);
    }
    return () => {
      alive = false;
    };
  }, [ckey, enabled, beat]);

  // the value of each Estadística card, again when its sensor, value or period changes (the server caches them)
  const skey = JSON.stringify(statItems);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    for (const x of statItems) {
      const key = `${x.entity}|${x.stat}|${x.period}`;
      if (stats[x.id]?.key === key && beat % 20 !== 0) continue;
      api.haStatistic(x.entity, x.stat, x.period).then((v) => {
        if (alive) setStats((old) => ({ ...old, [x.id]: { ...v, key } }));
      }, () => undefined);
    }
    return () => {
      alive = false;
    };
  }, [skey, enabled, beat]);

  return useMemo(() => {
    if (!enabled) return null;
    const states: Record<string, HaState> = {};
    for (const a of aliases) {
      const s = slim[a.entity];
      if (!s) continue;
      const { st: _raw, ...sl } = s;
      // an entity that looks like a door (or the water valve) offers nothing until the owner ticked it, as on the screen
      const dc = 'dc' in s ? s.dc ?? undefined : undefined;
      const locked = needsConfirm(a.entity.split('.')[0], { device_class: dc, friendly_name: s.n }, a.entity, a.name) && !a.ack;
      const st = { ...sl, c: a.touch && !locked && s.d !== 'unavailable' ? guessControls(a.kind, a.entity, s, a.props) : [] } as HaState;
      // an Entidad card's rows
      if (a.kind === 'ha.tile' && a.slot === 0 && s.d !== 'unavailable') {
        const f = guessFeatures(a.entity, s, a.props);
        if (f.length) st.f = f;
      }
      states[a.alias] = st;
    }
    const raw: Record<string, string> = {};
    for (const [e, s] of Object.entries(slim)) if (typeof s.st === 'string') raw[e] = s.st;
    const statOut: Record<string, HaStatistic> = {};
    for (const x of statItems) {
      const v = stats[x.id];
      if (v && v.key === `${x.entity}|${x.stat}|${x.period}`) statOut[x.id] = { stat: v.stat, period: v.period, value: v.value, unit: v.unit };
    }
    const history: Record<string, HaHistory> = {};
    for (const c of charts) {
      const h = points[c.id];
      if (!h || h.key !== `${c.entities.join(',')}|${c.period}`) continue;
      // a series without its own label takes the entity's name
      history[c.id] = { period: h.period, series: h.series.map((s, i) => ({ ...s, label: c.labels[i] || s.label || slim[c.entities[i]]?.n || '' })) };
    }
    return { states, history, frames, stats: statOut, raw };
  }, [aliases, slim, points, charts, enabled, frames, stats, statItems]);
}
