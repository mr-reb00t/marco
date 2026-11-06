// The commute settings: the Widgets section's commute widget (type 'commute') and the builder's Trayectos card share
// these pieces (builder/fields.tsx): the Google Maps API key, the saved routes
// (origin, destination, travel mode, direction / auto-reverse), live route test, refresh interval, and display options.
import { useEffect, useState } from 'preact/hooks';
import type { CommuteDirection, CommuteMode, CommuteRoute, CommuteWidgetOptions, TestCommuteResponse, CommuteKeyStatus, WidgetDef } from '../../shared/types';
import { COMMUTE_REFRESH_MIN, formatDistance, formatDurationParts, MAX_COMMUTE_ROUTES } from '../../../server/core/commuteCore.js';
import { api, ApiError } from '../api';
import { toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { Button, Field, ReorderButtons, Segmented, Select, TextInput, ToggleRow, WeekdayPicker } from '../components/ui';
import { weekdayNames } from '../dates';
import { t } from '../i18n';
import { moveItem, uid } from '../util';
import { previewTested } from '../widgetPreview';

export const newCommuteRoute = (): CommuteRoute => ({
  id: uid('cr'),
  name: '',
  origin: '',
  destination: '',
  mode: 'driving',
  direction: 'auto',
  reverseAfter: '12:00',
  days: [],
  from: '',
  to: '',
});

export const newCommuteOptions = (): CommuteWidgetOptions => ({
  units: 'auto',
  refreshMin: 10,
  showRouteSummary: true,
  showArrival: true,
  routes: [newCommuteRoute()],
});

const ERROR_TEXT: Record<string, string> = {
  key_missing: 'Añade tu clave de Google Maps arriba.',
  key_invalid: 'Google Maps no acepta esta clave. Revisa que Directions API o Routes API esté activada.',
  not_found: 'No se encontró una ruta entre esos dos lugares.',
  rate_limited: 'Límite de consultas alcanzado en Google Maps.',
  timeout: 'Google Maps no respondió a tiempo.',
  fetch_failed: 'No se pudo conectar con Google Maps.',
  bad_response: 'Respuesta no válida de Google Maps.',
  invalid_route: 'Escribe el origen y el destino.',
  busy: 'Hay demasiadas rutas en uso ahora. Prueba de nuevo en unos minutos.',
};

/**
 * The household's Google Maps key (GET/PUT /api/admin/commute/key): written once, kept on the server, never shown
 * again. `compact`: the builder's narrow Inspector (a shorter hint).
 */
export function CommuteApiKey({ compact = false }: { compact?: boolean }) {
  const [st, setSt] = useState<CommuteKeyStatus | null>(null);
  const [edit, setEdit] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.commuteKey().then(setSt).catch(() => setSt(null));
  }, []);
  const save = async (v: string) => {
    setSaving(true);
    try {
      setSt(await api.setCommuteKey(v));
      setEdit(false);
      setValue('');
      toast(v ? t('Clave guardada') : t('Clave quitada'));
    } catch (e) {
      toast((e as ApiError).status === 400 ? t('Google Maps no acepta esta clave. Revisa que Directions API o Routes API esté activada.') : t('No se pudo guardar la clave.'), 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Field
      label={t('Clave de API de Google Maps')}
      hint={
        <>
          {t('Activa Directions API o Routes API en')}{' '}
          <a href="https://console.cloud.google.com/apis/library" target="_blank" rel="noopener noreferrer">
            console.cloud.google.com
          </a>
          . {t('Se guarda solo en el servidor y nunca se vuelve a mostrar.')}
          {!compact && (
            <>
              {' '}
              {t('Google cobra las consultas que pasan de su cuota gratuita mensual. Cada ruta visible se consulta una vez por intervalo de actualización; un horario por ruta evita consultas cuando no hace falta.')}
            </>
          )}
        </>
      }
    >
      {st?.set && st.fromEnv && !edit ? (
        <>
          <div class="search-row">
            <span class="wx-key-saved">
              <Icon name="check" size={14} /> {t('Clave en GOOGLE_MAPS_API_KEY')} <span class="mono muted">…{st.hint}</span>
            </span>
            <Button onClick={() => setEdit(true)}>{t('Cambiar')}</Button>
          </div>
          <p class="muted">{t('Viene del entorno del servidor: para quitarla hay que cambiar ese entorno. Una clave guardada aquí la sustituye.')}</p>
        </>
      ) : st?.set && !edit ? (
        <div class="search-row">
          <span class="wx-key-saved">
            <Icon name="check" size={14} /> {t('Clave guardada')} <span class="mono muted">…{st.hint}</span>
          </span>
          <Button onClick={() => setEdit(true)}>{t('Cambiar')}</Button>
          <Button variant="danger" loading={saving} onClick={() => save('')}>
            {t('Quitar')}
          </Button>
        </div>
      ) : (
        <form
          class="search-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) void save(value.trim());
          }}
        >
          <TextInput mono value={value} placeholder="AIzaSy..." autocomplete="off" onValue={setValue} />
          <Button type="submit" loading={saving} disabled={!value.trim()}>
            {t('Guardar')}
          </Button>
        </form>
      )}
    </Field>
  );
}

function RouteTestResult({ res, units }: { res: TestCommuteResponse; units: 'auto' | 'metric' | 'imperial' }) {
  if (!res.ok) {
    return (
      <div class="test-result is-err">
        <span>
          <Icon name="alert" size={14} /> {t(ERROR_TEXT[res.error] ?? 'No se pudo consultar la ruta.')}
        </span>
      </div>
    );
  }
  const { hours, minutes } = formatDurationParts(res.durationSec);
  const durStr = hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
  const distStr = formatDistance(res.distanceMeters, units === 'imperial' ? 'imperial' : 'metric');
  const trafficLabel = res.traffic === 'heavy' ? t('Tráfico denso') : res.traffic === 'moderate' ? t('Tráfico moderado') : t('Tráfico fluido');
  return (
    <div class="widget-test">
      <div class={`test-result ${res.traffic === 'heavy' ? 'is-warn' : 'is-ok'}`}>
        <span>
          <Icon name="check" size={14} /> <strong>{durStr}</strong> ({trafficLabel})
          {distStr ? ` · ${distStr}` : ''}
          {res.summary ? ` · ${res.summary}` : ''}
        </span>
      </div>
    </div>
  );
}

const MODE_LABEL: Record<CommuteMode, string> = { driving: 'En coche', transit: 'Transporte público', bicycling: 'En bici', walking: 'A pie' };

/**
 * A commute widget's or a Trayectos card's routes: name, mode, origin and destination (with a Probar button: one
 * Google request, POST /api/admin/test/commute), direction and schedule; added, moved and removed. `errorOf(idx,
 * route, field)` the message under a field, if any; `hintOf` the same as a note that does not block saving (a card's
 * missing address). `compact`: the builder's narrow Inspector, one column, each route
 * folded to a line until it is opened. `onTested`: after a test (the widget preview loads again).
 */
export function CommuteRoutesEditor({ routes, onChange, errorOf, hintOf, units, onTested, compact = false, min = 1 }: {
  routes: CommuteRoute[];
  onChange: (next: CommuteRoute[]) => void;
  errorOf?: (idx: number, r: CommuteRoute, field: string) => string | undefined;
  hintOf?: (idx: number, r: CommuteRoute, field: string) => string | undefined;
  units: CommuteWidgetOptions['units'];
  onTested?: () => void;
  compact?: boolean;
  /** routes that stay (a widget keeps one, a card may have none) */
  min?: number;
}) {
  const [tests, setTests] = useState<Record<string, { loading: boolean; res?: TestCommuteResponse }>>({});
  const [open, setOpen] = useState<string | null>(null);
  const wd = weekdayNames('short');
  const put = (idx: number, patch: Partial<CommuteRoute>) => onChange(routes.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const grid = compact ? 'stack' : 'grid grid--2';

  const runTest = async (r: CommuteRoute) => {
    setTests((prev) => ({ ...prev, [r.id]: { loading: true } }));
    try {
      const res = await api.testCommute(r.origin.trim(), r.destination.trim(), r.mode);
      setTests((prev) => ({ ...prev, [r.id]: { loading: false, res } }));
      onTested?.();
    } catch (e) {
      setTests((prev) => ({ ...prev, [r.id]: { loading: false, res: { ok: false, error: (e as ApiError).message } } }));
    }
  };
  /** The days and hours of a folded route, in short ("lun mar mié · 07:00-09:30"), or ''. */
  const when = (r: CommuteRoute) => {
    const days = r.days.length && r.days.length < 7 ? [1, 2, 3, 4, 5, 6, 0].filter((d) => r.days.includes(d)).map((d) => wd[d]).join(' ') : '';
    const hours = r.from && r.to ? `${r.from}-${r.to}` : '';
    return [days, hours].filter(Boolean).join(' · ');
  };

  return (
    <div class="stack">
      {routes.map((r, idx) => {
        const err = (field: string) => {
          const msg = errorOf?.(idx, r, field);
          return msg ? t(msg) : undefined;
        };
        const hint = (field: string) => {
          const msg = hintOf?.(idx, r, field);
          return msg ? t(msg) : undefined;
        };
        const lacks = hint('origin') ?? hint('destination');
        const tState = tests[r.id];
        const title = r.name.trim() || `${t('Ruta')} ${idx + 1}`;
        const folded = compact && open !== r.id;
        const head = (
          <div class="subcard__head">
            {compact ? (
              <button type="button" class="link-btn bld-route-head" aria-expanded={!folded} onClick={() => setOpen(folded ? r.id : null)}>
                <Icon name={folded ? 'chevron' : 'up'} size={14} />
                <strong>{title}</strong>
                <span class="muted small">{t(MODE_LABEL[r.mode])}{when(r) ? ` · ${when(r)}` : ''}</span>
              </button>
            ) : (
              <strong class="subcard__title">{title}</strong>
            )}
            <div class="row-actions">
              <ReorderButtons index={idx} count={routes.length} onMove={(a, b) => onChange(moveItem(routes, a, b))} />
              {routes.length > min && (
                <button type="button" class="icon-btn icon-btn--danger" onClick={() => onChange(routes.filter((x) => x.id !== r.id))} aria-label={t('Eliminar')}>
                  <Icon name="trash" size={15} />
                </button>
              )}
            </div>
          </div>
        );
        return (
          <div key={r.id} class="subcard">
            {head}
            {folded ? (
              (err('origin') || err('destination')) ? <p class="small field__error">{err('origin') ?? err('destination')}</p> : lacks && <p class="subcard__hint">{lacks}</p>
            ) : (
              <>
                <div class={grid}>
                  <Field label={t('Nombre de la ruta')}>
                    <TextInput value={r.name} maxLength={60} placeholder={t('Trabajo')} onValue={(v) => put(idx, { name: v })} />
                  </Field>
                  <Field label={t('Modo de transporte')}>
                    <Select
                      value={r.mode}
                      options={(Object.keys(MODE_LABEL) as CommuteMode[]).map((m) => ({ value: m, label: t(MODE_LABEL[m]) }))}
                      onChange={(v) => put(idx, { mode: v })}
                    />
                  </Field>
                </div>
                <div class={grid}>
                  <Field label={t('Punto de salida')} error={err('origin')} hint={hint('origin') && <span class="subcard__hint">{hint('origin')}</span>}>
                    <TextInput value={r.origin} maxLength={200} placeholder={t('Dirección o lugar de salida')} error={!!err('origin')} onValue={(v) => put(idx, { origin: v })} />
                  </Field>
                  <Field label={t('Destino')} error={err('destination')} hint={hint('destination') && <span class="subcard__hint">{hint('destination')}</span>}>
                    <div class="search-row">
                      <TextInput value={r.destination} maxLength={200} placeholder={t('Dirección o lugar de llegada')} error={!!err('destination')} onValue={(v) => put(idx, { destination: v })} />
                      <Button size="sm" icon="play" disabled={!r.origin.trim() || !r.destination.trim()} loading={!!tState?.loading} onClick={() => void runTest(r)}>
                        {t('Probar')}
                      </Button>
                    </div>
                  </Field>
                </div>
                <div class={grid}>
                  <Field label={t('Dirección del trayecto')}>
                    <Select
                      value={r.direction}
                      options={[
                        { value: 'auto' as CommuteDirection, label: t('Automática (invierte por la tarde)') },
                        { value: 'to' as CommuteDirection, label: t('Siempre Origen → Destino') },
                        { value: 'from' as CommuteDirection, label: t('Siempre Destino → Origen') },
                      ]}
                      onChange={(v) => put(idx, { direction: v })}
                    />
                  </Field>
                  {r.direction === 'auto' && (
                    <Field label={t('Invertir a partir de')} error={err('reverseAfter')}>
                      <TextInput type="time" value={r.reverseAfter} onValue={(v) => put(idx, { reverseAfter: v })} />
                    </Field>
                  )}
                </div>
                <Field label={t('Días')} hint={t('Fuera de estos días y horas la ruta no se muestra ni se consulta a Google. Sin días marcados: todos; sin horas: todo el día.')}>
                  <WeekdayPicker labels={wd} value={r.days} onChange={(v) => put(idx, { days: v })} />
                </Field>
                <div class="grid grid--2">
                  <Field label={t('Desde')} error={err('from')}>
                    <TextInput type="time" value={r.from} error={!!err('from')} onValue={(v) => put(idx, { from: v })} />
                  </Field>
                  <Field label={t('Hasta')} error={err('to')}>
                    <TextInput type="time" value={r.to} error={!!err('to')} onValue={(v) => put(idx, { to: v })} />
                  </Field>
                </div>
              </>
            )}
            {tState?.res && <RouteTestResult res={tState.res} units={units} />}
          </div>
        );
      })}
      {routes.length < MAX_COMMUTE_ROUTES && (
        <div>
          <Button
            icon="plus"
            onClick={() => {
              const r = newCommuteRoute();
              onChange([...routes, r]);
              setOpen(r.id);
            }}
          >
            {t('Añadir ruta')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** How often, in which units and what else a commute widget or a Trayectos card shows. */
export function CommuteDisplayFields({ o, set, compact = false }: {
  o: Pick<CommuteWidgetOptions, 'refreshMin' | 'units' | 'showRouteSummary' | 'showArrival'>;
  set: <K extends 'refreshMin' | 'units' | 'showRouteSummary' | 'showArrival'>(k: K, v: CommuteWidgetOptions[K]) => void;
  compact?: boolean;
}) {
  return (
    <div class="stack">
      <div class={compact ? 'stack' : 'grid grid--2'}>
        <Field label={t('Actualizar cada')} hint={t('Cada actualización de una ruta es una consulta a Google.')}>
          <Select
            value={o.refreshMin}
            options={COMMUTE_REFRESH_MIN.map((m) => ({ value: m, label: `${m} min` }))}
            onChange={(v) => set('refreshMin', Number(v) as CommuteWidgetOptions['refreshMin'])}
          />
        </Field>
        <Field label={t('Unidades de distancia')}>
          <Segmented
            full
            value={o.units}
            options={[
              { value: 'auto', label: t('Automática') },
              { value: 'metric', label: 'km' },
              { value: 'imperial', label: 'mi' },
            ]}
            onChange={(v) => set('units', v)}
          />
        </Field>
      </div>
      <ToggleRow
        label={t('Mostrar vía principal')}
        hint={t('Muestra por qué autopista o avenida va la ruta recomendada.')}
        checked={o.showRouteSummary}
        onChange={(v) => set('showRouteSummary', v)}
      />
      <ToggleRow
        label={t('Mostrar hora estimada de llegada')}
        hint={t('Calcula la hora de llegada saliendo en este momento.')}
        checked={o.showArrival}
        onChange={(v) => set('showArrival', v)}
      />
    </div>
  );
}

export function CommuteWidgetFields({ w, errors, upd, part }: {
  w: WidgetDef; errors: Record<string, string>; upd: (fn: (x: WidgetDef) => void) => void; part: 'main' | 'more';
}) {
  const o = w.options.commute!;
  const set = (fn: (c: CommuteWidgetOptions) => void) => upd((x) => {
    if (x.options.commute) fn(x.options.commute);
  });
  if (part === 'more') return <CommuteDisplayFields o={o} set={(k, v) => set((c) => void (c[k] = v))} />;
  return (
    <div class="stack">
      <CommuteApiKey />
      <CommuteRoutesEditor
        routes={o.routes}
        units={o.units}
        onChange={(next) => set((c) => void (c.routes = next))}
        errorOf={(_idx, r, field) => errors[`wdg.${w.id}.route.${r.id}.${field}`]}
        onTested={() => previewTested(w.id)}
      />
    </div>
  );
}
