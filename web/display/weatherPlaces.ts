// The weather of the places a screen shows (#11): its own place ("Ubicación de esta pantalla", the household's when it
// has none) and the places of its Personalizado cards. The server answers /api/weather with the screen's own place and
// `places` for the others (server/weather.js); in the admin preview, places not saved yet come from the admin
// ('marco:preview-weather', posted with the answer of POST /api/admin/weather/preview).
import type { DisplayConfig, WeatherPlace, WeatherResponse } from '../shared/types';
import { homePlace, placeKey, weatherPlacesOf } from '../../server/core/weatherPlaces.js';
import { isPreview } from './identity';
import { set, state } from './store';

/** Admin preview: the weather of unsaved places, by placeKey. */
const preview = new Map<string, WeatherResponse>();

if (isPreview && typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.data?.type !== 'marco:preview-weather') return;
    const places = e.data.places as Record<string, WeatherResponse> | null;
    if (!places || typeof places !== 'object') return;
    let changed = false;
    for (const [k, w] of Object.entries(places)) {
      if (w && typeof w === 'object' && (w as WeatherResponse).current) {
        preview.set(k, w as WeatherResponse);
        changed = true;
      }
    }
    // the same answer again: every weather card draws itself anew
    if (changed && state.weather) set('weather', { ...state.weather });
  });
}

/** The key of a screen's own place (its weather.place, else the household's). */
export function screenPlaceKey(cfg: DisplayConfig | null | undefined): string | null {
  if (!cfg?.weather) return null;
  return placeKey(cfg.weather.place ?? homePlace(cfg.weather));
}

/**
 * What tells the weather of two screens apart: their language and the places they show. A carousel keeps one answer
 * per signature, so steps with the same places share it.
 */
export function weatherSig(cfg: DisplayConfig | null | undefined): string {
  if (!cfg) return '';
  return `${cfg.screen?.language ?? ''}|${weatherPlacesOf(cfg.weather, cfg.canvas?.items ?? null).map((p) => p.key).join(';')}`;
}

/** The weather at a place key: the screen's answer, its other places, or (admin preview) a place not saved yet. */
function byKey(key: string): WeatherResponse | null {
  const w = state.weather;
  if (w && (w.placeKey === key || (!w.placeKey && key === screenPlaceKey(state.config)))) return w;
  return w?.places?.[key] ?? preview.get(key) ?? null;
}

/**
 * The weather of the screen on display: its own place's. Falls back to what the server sent (an older server, or a
 * preview whose new place has not arrived yet).
 */
export function screenWeather(): WeatherResponse | null {
  const key = screenPlaceKey(state.config);
  return (key && byKey(key)) || state.weather;
}

/** The weather of a card: its own place (null = the screen's). */
export function placeWeather(place: WeatherPlace | null | undefined): WeatherResponse | null {
  if (!place || typeof place !== 'object') return screenWeather();
  return byKey(placeKey(place));
}
