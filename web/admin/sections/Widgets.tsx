import { useState } from 'preact/hooks';
import type { StoredConfig, TestWidgetResponse, WidgetDef, WidgetType } from '../../shared/types';
import { api, ApiError } from '../api';
import { confirmDialog } from '../components/feedback';
import { Icon, type IconName } from '../components/icons';
import { Button, Card, Empty, Field, PageHeader, ReorderButtons, SearchInput, Segmented, Select, TextInput, ToggleRow } from '../components/ui';
import { t } from '../i18n';
import { atLimit as reachesLimit, edition, has, limit } from '../caps';
import { setWidgetPreview } from '../livePreview';
import { moveItem, uid, WEB_WIDGET_REFRESH_SEC, WIDGET_REFRESH_SEC, widgetUrlProblem } from '../util';
import type { SectionProps } from './common';
import { previewTested, setPreviewWidget, useWidgetPreview } from '../widgetPreview';
import { newPriceOptions, PriceWidgetFields } from './PriceWidget';
import { PairsField } from '../builder/DataPickers';

/** A new Currency widget: the euro against the dollar, as a list with its 30 day curve (the Divisas card's defaults). */
export const newCurrencyOptions = (): NonNullable<WidgetDef['options']['currency']> => ({ pairs: [{ base: 'EUR', quote: 'USD' }], layout: 'list', range: '30d', chart: 'area', chartStyle: 'below' });

/** The Currency widget's options: the pairs, how they show, the period and the curve (the Divisas card's fields). */
function CurrencyWidgetFields({ w, errors, upd }: { w: WidgetDef; errors: Record<string, string>; upd: (fn: (x: WidgetDef) => void) => void }) {
  const o = w.options.currency ?? newCurrencyOptions();
  const set = <K extends keyof typeof o>(k: K, v: (typeof o)[K]) => upd((x) => void (x.options.currency = { ...(x.options.currency ?? newCurrencyOptions()), [k]: v }));
  return (
    <div class="stack">
      <Field label={t('Pares')} error={errors[`wdg.${w.id}.pairs`] ? t(errors[`wdg.${w.id}.pairs`]) : undefined}>
        <PairsField value={o.pairs} onChange={(v) => set('pairs', v)} />
      </Field>
      <div class="grid grid--2">
        <Field label={t('Cómo')} hint={t('En grande, si hay varios pares se van turnando cada 10 segundos.')}>
          <Segmented value={o.layout} options={[{ value: 'list', label: t('En lista') }, { value: 'big', label: t('Uno en grande') }]} onChange={(v) => set('layout', v)} />
        </Field>
        <Field label={t('Periodo')}>
          <Segmented value={o.range} options={[{ value: '7d', label: t('7 días') }, { value: '30d', label: t('30 días') }, { value: '1y', label: t('1 año') }]} onChange={(v) => set('range', v)} />
        </Field>
        <Field label={t('Curva')}>
          <Segmented value={o.chart} options={[{ value: 'area', label: t('Área') }, { value: 'line', label: t('Línea') }, { value: 'none', label: t('Sin curva') }]} onChange={(v) => set('chart', v)} />
        </Field>
        {o.chart !== 'none' && (
          <Field label={t('Estilo de la gráfica')}>
            <Segmented value={o.chartStyle} options={[{ value: 'below', label: t('Debajo') }, { value: 'background', label: t('De fondo') }]} onChange={(v) => set('chartStyle', v)} />
          </Field>
        )}
      </div>
    </div>
  );
}

/** Refresh choices as the admin shows them. */
const REFRESH_LABEL: Record<number, string> = {
  0: 'No recargar', 1: '1 s', 10: '10 s', 30: '30 s', 60: '1 min', 300: '5 min', 900: '15 min', 3600: '1 h', 21600: '6 h', 86400: '24 h',
};

/** One clear sentence per test error code (server/widgets.js), Spanish keys for t(). */
const ERROR_TEXT: Record<string, string> = {
  invalid_url: 'La dirección no es válida.',
  https_required: 'En Marco Cloud la dirección debe empezar por https://.',
  blocked_url: 'Esa dirección es de una red privada o local y Marco Cloud no puede llegar a ella.',
  timeout: 'La dirección no respondió a tiempo.',
  fetch_failed: 'No se pudo conectar con la dirección.',
  http_not_found: 'La dirección respondió 404: no existe.',
  http_denied: 'La dirección pide permiso (401/403).',
  http_error: 'La dirección respondió con un error.',
  too_many_redirects: 'Demasiadas redirecciones.',
  too_large: 'La imagen pesa más de 20 MB.',
  not_image: 'No es una imagen PNG, JPEG, WebP o GIF.',
  svg_not_allowed: 'Las imágenes SVG no se admiten en Marco Cloud. Usa PNG o WebP.',
  too_many_pixels: 'La imagen es demasiado grande en píxeles.',
  too_large_to_serve: 'La imagen es demasiado grande para mostrarla. Prueba con una de menos de 5 MB y 4096 px.',
  rate_limited: 'Demasiadas pruebas seguidas. Espera un minuto.',
  not_available: 'Este tipo de widget no está disponible aquí.',
  invalid_type: 'Este tipo de widget no está disponible aquí.',
};
const WARNING_TEXT: Record<string, string> = {
  refuses_framing: 'Esta página no deja que otras la muestren dentro de un marco: puede salir en blanco.',
  http_on_https: 'El panel va por https y la imagen por http: el navegador de la pantalla puede bloquearla.',
  large_image: 'La imagen es grande: en algunas teles puede tardar o fallar.',
  same_origin: 'No se puede incrustar una página de este mismo servidor.',
};
export const widgetErrorText = (code?: string) => t(ERROR_TEXT[code ?? ''] ?? 'No se pudo probar la dirección.');

const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Screens that show a widget (placed on them, or full screen with the Widget layout). */
export function widgetUses(full: StoredConfig, id: string) {
  return full.screens.filter((s) => (s.widgets ?? []).some((p) => p.widgetId === id) || (s.layout.preset === 'widget' && s.layout.widgetId === id));
}

/** Diseño card where a screen has widget `id`: the full-screen widget, or the widgets on that screen. */
export const widgetUseAnchor = (s: StoredConfig['screens'][number], id: string) =>
  s.layout.preset === 'widget' && s.layout.widgetId === id ? 'layout/layout-options' : 'layout/layout-widgets';

/** Where a screen shows widget `id`: full screen, in a corner, in the side column. */
function widgetPlaces(s: StoredConfig['screens'][number], id: string) {
  const out = new Set<string>();
  if (s.layout.preset === 'widget' && s.layout.widgetId === id) out.add(t('Pantalla completa'));
  for (const p of s.widgets ?? []) if (p.widgetId === id) out.add(p.place === 'side' ? t('Lateral') : t('Esquina'));
  return [...out];
}

/** The type as the admin names it (the type select and the folded card). */
const TYPE_LABEL: Record<WidgetType, string> = { image: 'Imagen', web: 'Página web', prices: 'Precio de la luz', currency: 'Divisas' };
const typeIcon = (type: WidgetType): IconName => (type === 'image' ? 'image' : type === 'prices' ? 'zap' : type === 'currency' ? 'exchange' : 'globe');

const LS_OPEN = 'calendar-admin.widgets-open';
/** Ids of the widget cards left open (this browser only). */
function loadOpen(): Set<string> {
  try {
    const v = localStorage.getItem(LS_OPEN);
    return new Set(v ? (JSON.parse(v) as string[]) : []);
  } catch {
    return new Set();
  }
}
function storeOpen(ids: Set<string>) {
  try {
    localStorage.setItem(LS_OPEN, JSON.stringify([...ids]));
  } catch { /* private mode: only for this visit */ }
}

/** A widget leaves every screen: its placements and the full-screen layout that pointed at it. */
export function pruneWidget(d: StoredConfig, id: string) {
  d.widgets = (d.widgets ?? []).filter((w) => w.id !== id);
  for (const s of d.screens) {
    if (s.widgets) s.widgets = s.widgets.filter((p) => p.widgetId !== id);
    if (s.layout.widgetId === id) s.layout.widgetId = null;
  }
}

export const newWidget = (type: WidgetType = 'image'): WidgetDef => ({
  id: uid('w'),
  type,
  name: '',
  options: { url: '', refreshSec: type === 'web' ? 0 : 900, fit: 'contain', bust: true },
});

/** True for an http(s) address on another origin than this panel's (what may go in a thumbnail frame). */
const frameable = (url: string) => {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== location.origin;
  } catch {
    return false;
  }
};

/** Small sandboxed frame of a web widget, scaled down (same attributes as the screen's). */
function WebThumb({ url, name }: { url: string; name: string }) {
  // never this panel's own origin: scripts plus the same origin would lift the sandbox
  if (!frameable(url)) return null;
  return (
    <div class="widget-thumb widget-thumb--web">
      <iframe src={url} title={name} sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" allow="" loading="lazy" tabIndex={-1} />
    </div>
  );
}

function TestResult({ w, res }: { w: WidgetDef; res: TestWidgetResponse }) {
  const [imgOk, setImgOk] = useState<boolean | null>(null);
  const image = w.type === 'image';
  // the browser of this panel may reach an address the server cannot (and the other way round): show both
  const showImg = image && !!(res.previewUrl || !widgetUrlProblem(w.options.url)) && (res.ok || imgOk !== false);
  return (
    <div class="widget-test">
      {showImg && (
        <div class={`widget-thumb ${imgOk === false ? 'is-hidden' : ''}`}>
          <img src={res.previewUrl ?? w.options.url} alt="" referrerpolicy="no-referrer" onLoad={() => setImgOk(true)} onError={() => setImgOk(false)} />
        </div>
      )}
      {!image && res.ok && <WebThumb url={w.options.url} name={w.name} />}
      <div class={`test-result ${res.ok ? 'is-ok' : imgOk ? 'is-warn' : 'is-err'}`}>
        {res.ok ? (
          <span>
            <Icon name="check" size={14} />{' '}
            {image ? (
              <>
                <strong>{(res.format ?? '').toUpperCase() || t('Imagen')}</strong>
                {res.width && res.height ? ` · ${res.width} × ${res.height}` : ''}
                {res.bytes ? ` · ${formatBytes(res.bytes)}` : ''}
              </>
            ) : (
              <strong>{t('La página responde')}</strong>
            )}
          </span>
        ) : (
          <span>
            <Icon name="alert" size={14} /> {widgetErrorText(res.error)}
            {imgOk && <> {t('Este navegador sí la ve, así que la pantalla probablemente también.')}</>}
          </span>
        )}
      </div>
      {(res.warnings ?? []).map((k) => (
        <div class="test-result is-warn" key={k}>
          <span>
            <Icon name="alert" size={14} /> {t(WARNING_TEXT[k] ?? k)}
          </span>
        </div>
      ))}
    </div>
  );
}

function WidgetCard({ w, i, n, full, errors, upd, remove, move, go, setScreenId, previewed, open, locked, toggle }: {
  w: WidgetDef; i: number; n: number; full: StoredConfig; errors: Record<string, string>; previewed: boolean;
  /** unfolded; `locked`: kept open (it has an error), the fold button is off */
  open: boolean; locked: boolean; toggle: () => void;
  upd: (fn: (x: WidgetDef) => void) => void; remove: () => void; move: (a: number, b: number) => void;
  go: (route: string) => void; setScreenId: (id: string) => void;
}) {
  const [test, setTest] = useState<{ loading: boolean; res?: TestWidgetResponse; key?: string }>({ loading: false });
  const [more, setMore] = useState(false);
  const image = w.type === 'image';
  const prices = w.type === 'prices';
  const currency = w.type === 'currency';
  /** a card this server feeds (no address, no reload interval) */
  const own = prices || currency;
  // Marco Cloud fetches the image itself (https only) and serves it to the screens; self-hosted TVs load the address
  const cloud = edition() === 'cloud';
  const webOk = has('webWidgets');
  const pricesOk = has('priceWidgets');
  const urlBad = widgetUrlProblem(w.options.url, cloud);
  // choices below the server's shortest refresh are not offered (web pages keep "never reload")
  const minRefresh = limit('widgetMinRefreshSec') ?? 0;
  const refreshList = (image ? WIDGET_REFRESH_SEC : WEB_WIDGET_REFRESH_SEC).filter((s) => s === 0 || s >= minRefresh);
  const belowMin = !refreshList.includes(w.options.refreshSec) && w.options.refreshSec > 0 && w.options.refreshSec < minRefresh;
  const uses = widgetUses(full, w.id);
  // open display access: the display config (and so the address) is readable by anyone on the network
  const openTokenUrl = !cloud && !urlBad && /[?#]./.test(w.options.url) && full.security?.displayAccess !== 'private';
  const run = async () => {
    const key = `${w.type}|${w.options.url.trim()}`;
    setTest({ loading: true, key });
    try {
      const r = await api.testWidget(w.type, w.options.url.trim());
      // the unsaved preview shows this copy until the widget is saved (Marco Cloud, Preview.tsx)
      if (r.ok && r.previewUrl) setWidgetPreview(w.options.url.trim(), r.previewUrl);
      setTest({ loading: false, key, res: r });
    } catch (e) {
      setTest({ loading: false, key, res: { ok: false, error: (e as ApiError).message } });
    }
    // the widget preview shows this one and loads it again
    previewTested(w.id);
  };
  // a result belongs to the address and type it was made for
  const res = test.key === `${w.type}|${w.options.url.trim()}` ? test.res : undefined;
  return (
    // the preview shows the widget the owner is working on
    <div class="widget-card-wrap" onFocusIn={() => setPreviewWidget(w.id)} onPointerDown={() => setPreviewWidget(w.id)}>
    <section id={`widget-${w.id}`} class={`card widget-card ${previewed ? 'is-previewed' : ''} ${open ? '' : 'is-folded'}`}>
      <header class="card__head">
        <button type="button" class="icon-btn car-fold" aria-expanded={open} disabled={locked} title={open ? t('Plegar') : t('Desplegar')} onClick={toggle}>
          <Icon name="chevron" size={16} />
        </button>
        <span class="card__icon">
          <Icon name={typeIcon(w.type)} size={18} />
        </span>
        <button type="button" class="car-fold__name" aria-expanded={open} onClick={toggle}>
          <strong>{w.name.trim() || t('Widget sin nombre')}</strong>
          <span class="muted small">
            {t(TYPE_LABEL[w.type])}
            {' · '}
            {uses.length ? uses.map((s) => `${s.name} (${widgetPlaces(s, w.id).join(', ')})`).join(', ') : t('En ninguna pantalla')}
          </span>
        </button>
        {locked && <Icon name="alert" size={16} class="widget-card__err" />}
        <div class="card__actions row-actions">
          <ReorderButtons index={i} count={n} onMove={move} />
          <button type="button" class="icon-btn icon-btn--danger" onClick={remove} aria-label={t('Eliminar')}>
            <Icon name="trash" size={16} />
          </button>
        </div>
      </header>
      {open && (
      <div class="card__body">
      <div class="grid grid--2">
        <Field label={t('Nombre')} error={errors[`wdg.${w.id}.name`]}>
          <TextInput value={w.name} maxLength={60} placeholder={currency ? t('Cambio de divisas') : t('Precios de la luz')} onValue={(v) => upd((x) => void (x.name = v))} />
        </Field>
        <Field
          label={t('Tipo')}
          error={errors[`wdg.${w.id}.type`] ? t(errors[`wdg.${w.id}.type`]) : undefined}
          hint={
            w.type === 'web'
              ? t('Una página web dentro de un marco aislado (iframe). Solo para servidores propios.')
              : prices
                ? t('Precio de la electricidad de tu zona, hoy y mañana. Lo consulta este servidor; las pantallas no llaman a ninguna web.')
                : currency
                  ? t('El cambio de monedas del Banco Central Europeo. Lo consulta este servidor unas pocas veces al día; las pantallas no llaman a ninguna web.')
                  : undefined
          }
        >
          {((w.type === 'web' && !webOk) || (prices && !pricesOk)) && <span class="chip chip--static chip--bad">{t('No disponible aquí')}</span>}
          <Select<WidgetType>
            value={w.type}
            error={!!errors[`wdg.${w.id}.type`]}
            options={[
              { value: 'image' as const },
              ...(webOk || w.type === 'web' ? [{ value: 'web' as const }] : []),
              ...(pricesOk || prices ? [{ value: 'prices' as const }] : []),
              { value: 'currency' as const },
            ].map((o) => ({ ...o, label: t(TYPE_LABEL[o.value]) }))}
            onChange={(v) =>
              upd((x) => {
                if (x.type === v) return;
                x.type = v;
                if (v === 'prices') {
                  delete x.options.currency;
                  x.options.prices ??= newPriceOptions(full.datetime.timezone);
                  return;
                }
                delete x.options.prices;
                if (v === 'currency') {
                  x.options.currency ??= newCurrencyOptions();
                  return;
                }
                delete x.options.currency;
                const list = v === 'web' ? WEB_WIDGET_REFRESH_SEC : WIDGET_REFRESH_SEC;
                if (!list.includes(x.options.refreshSec)) x.options.refreshSec = v === 'web' ? 0 : 900;
              })
            }
          />
        </Field>
      </div>
      {prices && w.options.prices && <PriceWidgetFields w={w} errors={errors} upd={upd} part="main" tz={full.datetime.timezone} />}
      {currency && <CurrencyWidgetFields w={w} errors={errors} upd={upd} />}
      {!own && (
        <>
          <Field
            label={t('Dirección')}
            error={errors[`wdg.${w.id}.url`] ? t(errors[`wdg.${w.id}.url`]) : undefined}
            hint={
              image
                ? `${t('PNG, JPEG, WebP o GIF.')} ${cloud ? t('Debe empezar por https://. Marco descarga la imagen y la sirve a tus pantallas.') : t('La pantalla carga la dirección directamente: puede ser de tu red local.')}`
                : undefined
            }
          >
            <div class="search-row">
              <TextInput
                mono
                inputMode="url"
                value={w.options.url}
                placeholder={image ? 'https://…/tarjeta.png' : 'https://…'}
                error={!!errors[`wdg.${w.id}.url`]}
                onValue={(v) => upd((x) => void (x.options.url = v))}
              />
              <Button size="sm" icon="play" disabled={!!urlBad} loading={test.loading} onClick={run}>
                {t('Probar')}
              </Button>
            </div>
          </Field>
          {openTokenUrl && (
            <p class="muted small">
              {t('Las pantallas están en modo abierto: cualquiera en tu red puede leer esta dirección completa. Si lleva una clave, cambia el acceso a las pantallas a privado.')}{' '}
              <button type="button" class="link-btn" onClick={() => go('security/sec-display')}>
                {t('Acceso a las pantallas')}
              </button>
            </p>
          )}
          {res && <TestResult key={test.key} w={w} res={res} />}
        </>
      )}
      <div class="grid grid--2">
        {!own && (
          <Field label={t('Recargar cada')} error={errors[`wdg.${w.id}.refreshSec`] ? t(errors[`wdg.${w.id}.refreshSec`]) : undefined}>
            <Select
              value={w.options.refreshSec}
              options={[...(belowMin ? [w.options.refreshSec] : []), ...refreshList].map((s) => ({ value: s, label: s >= 3600 && s % 3600 === 0 ? t('{n} h', { n: s / 3600 }) : t(REFRESH_LABEL[s] ?? `${s} s`) }))}
              onChange={(v) => upd((x) => void (x.options.refreshSec = v))}
            />
            {belowMin && <p class="muted small">{t('Aquí lo mínimo es {n} s.', { n: minRefresh })}</p>}
          </Field>
        )}
        <Field label={t('Usado en')}>
          {uses.length ? (
            <div class="widget-uses">
              {uses.map((s) => (
                <button
                  type="button"
                  class="chip chip--static chip--link"
                  title={t('Ver dónde está en Diseño')}
                  onClick={() => {
                    setScreenId(s.id);
                    go(widgetUseAnchor(s, w.id));
                  }}
                >
                  {s.name}
                </button>
              ))}
            </div>
          ) : (
            <p class="muted small">{t('Aún no está en ninguna pantalla. Colócalo en Diseño.')}</p>
          )}
        </Field>
      </div>
      {!currency && <button type="button" class="link-btn widget-more" aria-expanded={more} onClick={() => setMore(!more)}>
        <Icon name={more ? 'up' : 'chevron'} size={14} /> {t('Más opciones')}
      </button>}
      {more && prices && w.options.prices && <PriceWidgetFields w={w} errors={errors} upd={upd} part="more" tz={full.datetime.timezone} />}
      {more && !own && (
        <div class="stack">
          <Field label={t('Ajuste')} hint={t('Solo cuenta cuando el widget ocupa toda la pantalla.')}>
            <Segmented
              value={w.options.fit}
              options={[
                { value: 'contain', label: t('Completa') },
                { value: 'cover', label: t('Rellenar') },
              ]}
              onChange={(v) => upd((x) => void (x.options.fit = v))}
            />
          </Field>
          {image && !cloud && (
            <ToggleRow
              label={t('Pedir siempre la imagen nueva')}
              hint={t('Desactívalo si la dirección ya cambia sola, por ejemplo con firma.')}
              checked={w.options.bust}
              onChange={(v) => upd((x) => void (x.options.bust = v))}
            />
          )}
        </div>
      )}
      </div>
      )}
    </section>
    </div>
  );
}

export function WidgetsSection({ full, setFull, errors, go, setScreenId }: SectionProps) {
  const items = full.widgets ?? [];
  // cards fold to one line and start folded; the ones opened are remembered in this browser
  const [openIds, setOpenIds] = useState<Set<string>>(loadOpen);
  const setOpen = (id: string, on: boolean) =>
    setOpenIds((cur) => {
      if (cur.has(id) === on) return cur;
      const n = new Set(cur);
      if (on) n.add(id);
      else n.delete(id);
      storeOpen(n);
      return n;
    });
  const hasErr = (id: string) => Object.keys(errors).some((k) => k.startsWith(`wdg.${id}.`));
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const matches = (w: WidgetDef) =>
    !query ||
    hasErr(w.id) ||
    [w.name.trim() || t('Widget sin nombre'), t(TYPE_LABEL[w.type]), ...widgetUses(full, w.id).map((s) => s.name)].some((x) => x.toLowerCase().includes(query));
  const shown = items.filter(matches);
  const max = limit('widgets');
  const atLimit = reachesLimit('widgets', items.length);
  const pv = useWidgetPreview();
  const pvId = items.some((w) => w.id === pv.id) ? pv.id : items[0]?.id;
  const add = () => {
    const w = newWidget();
    setFull((d) => {
      d.widgets = d.widgets ?? [];
      d.widgets.push(w);
    });
    // a new widget opens unfolded, with no search hiding it
    setOpen(w.id, true);
    setQ('');
    setPreviewWidget(w.id);
  };
  const move = (a: number, b: number) => setFull((d) => void (d.widgets = moveItem(d.widgets ?? [], a, b)));
  const remove = async (w: WidgetDef) => {
    const n = widgetUses(full, w.id).length;
    if (n) {
      const ok = await confirmDialog({
        title: t('Eliminar el widget “{name}”', { name: w.name.trim() || t('Widget sin nombre') }),
        body: <p>{t('Se quitará también de {n} pantallas.', { n })}</p>,
        confirm: t('Eliminar'),
        danger: true,
      });
      if (!ok) return;
    }
    setFull((d) => pruneWidget(d, w.id));
  };
  return (
    <>
      <PageHeader
        title={t('Widgets')}
        desc={t('Imágenes y páginas web que se muestran en tus pantallas. Aquí defines qué se muestra; dónde va cada uno lo eliges en Diseño de cada pantalla.')}
      >
        <Button variant="primary" icon="plus" disabled={atLimit} onClick={add}>
          {t('Añadir widget')}
        </Button>
      </PageHeader>
      {atLimit && max != null && <p class="muted small">{t('Máximo {n} widgets', { n: max })}</p>}
      {items.length === 0 ? (
        <Card>
          <Empty icon="widget" title={t('Aún no hay widgets')}>
            <p>{t('Un widget es una imagen o una página web que se ve en una esquina, en la columna lateral o a pantalla completa. Por ejemplo, una tarjeta de precios que se genera sola.')}</p>
            <Button variant="primary" icon="plus" onClick={add}>
              {t('Añadir widget')}
            </Button>
          </Empty>
        </Card>
      ) : (
        <>
          {items.length > 3 && <SearchInput value={q} onValue={setQ} placeholder={t('Buscar widget, tipo o pantalla…')} />}
          {items.length > 3 && !shown.length && <p class="muted small">{t('Ningún widget coincide con «{q}».', { q })}</p>}
          {shown.map((w) => {
          const i = items.indexOf(w);
          // a card with an error is always open: errors are never hidden in a folded card
          const locked = hasErr(w.id);
          const open = locked || openIds.has(w.id);
          return (
          <WidgetCard
            key={w.id}
            w={w}
            i={i}
            open={open}
            locked={locked}
            toggle={() => {
              if (locked) return;
              setOpen(w.id, !open);
              if (!open) setPreviewWidget(w.id);
            }}
            n={items.length}
            previewed={items.length > 1 && w.id === pvId}
            full={full}
            errors={errors}
            move={move}
            go={go}
            setScreenId={setScreenId}
            remove={() => void remove(w)}
            upd={(fn) =>
              setFull((d) => {
                const x = (d.widgets ?? []).find((y) => y.id === w.id);
                if (x) fn(x);
              })
            }
          />
          );
          })}
        </>
      )}
    </>
  );
}
