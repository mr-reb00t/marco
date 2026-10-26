// The commute time widget's settings (Widgets section, type 'commute'): Google Maps API key, saved routes
// (origin, destination, travel mode, direction / auto-reverse), live route test, refresh interval, and display options.
import { useEffect, useState } from 'preact/hooks';
import type { CommuteDirection, CommuteMode, CommuteRoute, CommuteWidgetOptions, TestCommuteResponse, WeatherKeyStatus, WidgetDef } from '../../shared/types';
import { COMMUTE_REFRESH_MIN, formatDistance, formatDurationParts, MAX_COMMUTE_ROUTES } from '../../../server/core/commuteCore.js';
import { api, ApiError } from '../api';
import { toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { Button, Field, ReorderButtons, Segmented, Select, TextInput, ToggleRow } from '../components/ui';
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
};

function CommuteApiKey({ st, setSt }: { st: WeatherKeyStatus | null; setSt: (s: WeatherKeyStatus) => void }) {
  const [edit, setEdit] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
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
        </>
      }
    >
      {st?.set && !edit ? (
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

export function CommuteWidgetFields({ w, errors, upd, part }: {
  w: WidgetDef; errors: Record<string, string>; upd: (fn: (x: WidgetDef) => void) => void; part: 'main' | 'more';
}) {
  const o = w.options.commute!;
  const set = (fn: (c: CommuteWidgetOptions) => void) => upd((x) => {
    if (x.options.commute) fn(x.options.commute);
  });
  const [keyStatus, setKeyStatus] = useState<WeatherKeyStatus | null>(null);
  const [tests, setTests] = useState<Record<string, { loading: boolean; res?: TestCommuteResponse }>>({});

  useEffect(() => {
    api.commuteKey().then(setKeyStatus).catch(() => setKeyStatus(null));
  }, []);

  const runTest = async (r: CommuteRoute) => {
    setTests((prev) => ({ ...prev, [r.id]: { loading: true } }));
    try {
      const res = await api.testCommute(r.origin.trim(), r.destination.trim(), r.mode);
      setTests((prev) => ({ ...prev, [r.id]: { loading: false, res } }));
      previewTested(w.id);
    } catch (e) {
      setTests((prev) => ({ ...prev, [r.id]: { loading: false, res: { ok: false, error: (e as ApiError).message } } }));
    }
  };

  if (part === 'more') {
    return (
      <div class="stack">
        <div class="grid grid--2">
          <Field label={t('Actualizar cada')}>
            <Select
              value={o.refreshMin}
              options={COMMUTE_REFRESH_MIN.map((m) => ({ value: m, label: `${m} min` }))}
              onChange={(v) => set((c) => void (c.refreshMin = Number(v) as CommuteWidgetOptions['refreshMin']))}
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
              onChange={(v) => set((c) => void (c.units = v))}
            />
          </Field>
        </div>
        <ToggleRow
          label={t('Mostrar vía principal')}
          hint={t('Muestra por qué autopista o avenida va la ruta recomendada.')}
          checked={o.showRouteSummary}
          onChange={(v) => set((c) => void (c.showRouteSummary = v))}
        />
        <ToggleRow
          label={t('Mostrar hora estimada de llegada')}
          hint={t('Calcula la hora de llegada saliendo en este momento.')}
          checked={o.showArrival}
          onChange={(v) => set((c) => void (c.showArrival = v))}
        />
      </div>
    );
  }

  return (
    <div class="stack">
      <CommuteApiKey st={keyStatus} setSt={setKeyStatus} />
      <div class="stack">
        {o.routes.map((r, idx) => {
          const rErr = (field: string) => {
            const msg = errors[`wdg.${w.id}.route.${r.id}.${field}`];
            return msg ? t(msg) : undefined;
          };
          const tState = tests[r.id];
          return (
            <div key={r.id} class="subcard">
              <div class="subcard__head">
                <strong>{r.name.trim() || `${t('Ruta')} ${idx + 1}`}</strong>
                <div class="row-actions">
                  <ReorderButtons index={idx} count={o.routes.length} onMove={(a, b) => set((c) => void (c.routes = moveItem(c.routes, a, b)))} />
                  {o.routes.length > 1 && (
                    <button
                      type="button"
                      class="icon-btn icon-btn--danger"
                      onClick={() => set((c) => void (c.routes = c.routes.filter((x) => x.id !== r.id)))}
                      aria-label={t('Eliminar')}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  )}
                </div>
              </div>
              <div class="grid grid--2">
                <Field label={t('Nombre de la ruta')}>
                  <TextInput
                    value={r.name}
                    maxLength={60}
                    placeholder={t('Trabajo')}
                    onValue={(v) => set((c) => void (c.routes[idx].name = v))}
                  />
                </Field>
                <Field label={t('Modo de transporte')}>
                  <Select
                    value={r.mode}
                    options={[
                      { value: 'driving' as CommuteMode, label: t('En coche') },
                      { value: 'transit' as CommuteMode, label: t('Transporte público') },
                      { value: 'bicycling' as CommuteMode, label: t('En bici') },
                      { value: 'walking' as CommuteMode, label: t('A pie') },
                    ]}
                    onChange={(v) => set((c) => void (c.routes[idx].mode = v))}
                  />
                </Field>
              </div>
              <div class="grid grid--2">
                <Field label={t('Punto de salida')} error={rErr('origin')}>
                  <TextInput
                    value={r.origin}
                    maxLength={200}
                    placeholder={t('Dirección o lugar de salida')}
                    error={!!rErr('origin')}
                    onValue={(v) => set((c) => void (c.routes[idx].origin = v))}
                  />
                </Field>
                <Field label={t('Destino')} error={rErr('destination')}>
                  <div class="search-row">
                    <TextInput
                      value={r.destination}
                      maxLength={200}
                      placeholder={t('Dirección o lugar de llegada')}
                      error={!!rErr('destination')}
                      onValue={(v) => set((c) => void (c.routes[idx].destination = v))}
                    />
                    <Button
                      size="sm"
                      icon="play"
                      disabled={!r.origin.trim() || !r.destination.trim()}
                      loading={!!tState?.loading}
                      onClick={() => void runTest(r)}
                    >
                      {t('Probar')}
                    </Button>
                  </div>
                </Field>
              </div>
              <div class="grid grid--2">
                <Field label={t('Dirección del trayecto')}>
                  <Select
                    value={r.direction}
                    options={[
                      { value: 'auto' as CommuteDirection, label: t('Automática (invierte por la tarde)') },
                      { value: 'to' as CommuteDirection, label: t('Siempre Origen → Destino') },
                      { value: 'from' as CommuteDirection, label: t('Siempre Destino → Origen') },
                    ]}
                    onChange={(v) => set((c) => void (c.routes[idx].direction = v))}
                  />
                </Field>
                {r.direction === 'auto' && (
                  <Field label={t('Invertir a partir de')} error={rErr('reverseAfter')}>
                    <TextInput
                      type="time"
                      value={r.reverseAfter}
                      onValue={(v) => set((c) => void (c.routes[idx].reverseAfter = v))}
                    />
                  </Field>
                )}
              </div>
              {tState?.res && <RouteTestResult res={tState.res} units={o.units} />}
            </div>
          );
        })}
        {o.routes.length < MAX_COMMUTE_ROUTES && (
          <div>
            <Button icon="plus" onClick={() => set((c) => void c.routes.push(newCommuteRoute()))}>
              {t('Añadir ruta')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
