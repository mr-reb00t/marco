// Place search for the weather (#11): the household's place, a screen's place ("Ubicación de esta pantalla"), a
// weather card's own place and the places of "Tiempo en varias ciudades". Through this server (GET /api/admin/geocode),
// so the browser only talks to its own server.
import { useState } from 'preact/hooks';
import type { GeocodeResult, WeatherPlace } from '../../shared/types';
import { api, ApiError } from '../api';
import { getLang, t } from '../i18n';
import { toast } from './feedback';
import { Icon } from './icons';
import { Button, Segmented, TextInput } from './ui';

/** A search result as a place: "Porto, Porto District" at 3 decimals. */
export function placeOfResult(r: GeocodeResult): WeatherPlace {
  return { name: [r.name, r.admin1].filter(Boolean).join(', '), lat: Math.round(r.lat * 1000) / 1000, lon: Math.round(r.lon * 1000) / 1000 };
}

/** A search box and its results; picking one calls `onPick` and clears the box. */
export function PlaceSearch({ onPick, autoFocus }: { onPick: (p: WeatherPlace, r: GeocodeResult) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const search = async (e?: Event) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    try {
      const j = await api.geocode(q.trim(), getLang());
      setResults(j.results ?? []);
    } catch (err) {
      setResults([]);
      if ((err as ApiError).status === 429) toast(t('Demasiadas búsquedas seguidas. Espera unos minutos.'), 'error');
      else toast(t('No se pudo buscar (¿sin conexión a Internet?). Inténtalo de nuevo.'), 'error');
    } finally {
      setSearching(false);
    }
  };
  return (
    <div class="place-search">
      <form class="search-row" onSubmit={search}>
        <TextInput value={q} onValue={setQ} placeholder={t('Buscar ciudad…')} prefix={<Icon name="search" size={14} />} autoFocus={autoFocus} />
        <Button type="submit" loading={searching}>
          {t('Buscar')}
        </Button>
      </form>
      {results && (
        <div class="geo-results">
          {results.length === 0 && <div class="muted small">{t('Sin resultados')}</div>}
          {results.map((r) => (
            <button
              type="button"
              class="geo-result"
              onClick={() => {
                onPick(placeOfResult(r), r);
                setResults(null);
                setQ('');
              }}
            >
              <Icon name="pin" size={14} />
              <span>
                <strong>{r.name}</strong> <span class="muted">{[r.admin1, r.country].filter(Boolean).join(', ')}</span>
              </span>
              <span class="mono small muted">
                {r.lat.toFixed(3)}, {r.lon.toFixed(3)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A place that may be left to someone else: `inherit` names who (the household's place, the screen's); null = that
 * one. "Otro lugar" shows the search until a place is picked.
 */
export function PlaceChoice({ value, onChange, inherit, inheritHint }: { value: WeatherPlace | null | undefined; onChange: (p: WeatherPlace | null) => void; inherit: string; inheritHint?: string }) {
  const [open, setOpen] = useState(false);
  const own = !!value;
  const mode = own || open ? 'other' : 'same';
  return (
    <div class="stack place-choice">
      <Segmented
        full
        value={mode}
        options={[
          { value: 'same', label: inherit },
          { value: 'other', label: t('Otro lugar') },
        ]}
        onChange={(v) => {
          if (v === 'same') {
            setOpen(false);
            onChange(null);
          } else setOpen(true);
        }}
      />
      {mode === 'same' && inheritHint && <div class="muted small">{inheritHint}</div>}
      {mode === 'other' && value && (
        <div class="place-chosen">
          <Icon name="pin" size={14} />
          <strong>{value.name || `${value.lat}, ${value.lon}`}</strong>
          <span class="mono small muted">
            {value.lat.toFixed(3)}, {value.lon.toFixed(3)}
          </span>
        </div>
      )}
      {mode === 'other' && <PlaceSearch autoFocus={!value} onPick={(p) => onChange(p)} />}
    </div>
  );
}

/** The places of "Tiempo en varias ciudades": a name each (editable), removed down to `min`, added up to `max`. */
export function PlaceList({ value, onChange, min = 2, max = 8 }: { value: WeatherPlace[] | null | undefined; onChange: (v: WeatherPlace[]) => void; min?: number; max?: number }) {
  const list = Array.isArray(value) ? value : [];
  const [adding, setAdding] = useState(false);
  return (
    <div class="stack place-list">
      {list.map((p, i) => (
        <div class="place-row">
          <Icon name="pin" size={14} />
          <TextInput value={p.name} maxLength={80} placeholder={t('Nombre')} aria-label={t('Nombre')} onValue={(v) => onChange(list.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
          <button type="button" class="icon-btn" disabled={list.length <= min} onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={t('Quitar')} title={list.length <= min ? t('Hacen falta al menos {n} lugares.', { n: min }) : t('Quitar')}>
            ×
          </button>
        </div>
      ))}
      {list.length < max && !adding && (
        <button type="button" class="link-btn" onClick={() => setAdding(true)}>
          {t('Añadir lugar')}
        </button>
      )}
      {list.length < max && adding && (
        <PlaceSearch
          autoFocus
          onPick={(p) => {
            onChange([...list, p]);
            setAdding(false);
          }}
        />
      )}
      {list.length >= max && <div class="muted small">{t('Hasta {n} lugares.', { n: max })}</div>}
    </div>
  );
}
