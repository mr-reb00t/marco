// First-run setup wizard (shown instead of the login while the server has no admin password).
// Steps: welcome + language → admin password → location → calendars → look → done (display URL + QR).
// Server side: server/setup.js (POST /api/setup/complete creates the password + settings and logs in).
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { passwordProblem, passwordScore, MIN_PASSWORD } from '../shared/password';
import { BrandMark } from './components/BrandMark';
import { CopyField, Qr } from './components/share';
import { kioskInstallCommand, REPO_URL } from '../shared/project';
import type { GeocodeResult, Lang, LayoutPreset, SetupRequest, SetupStatus, TestIcsResponse } from '../shared/types';
import { api, ApiError } from './api';
import { Icon, type IconName } from './components/icons';
import { LangMenu } from './components/LangMenu';
import { Button, Callout, Field, Segmented, TextInput } from './components/ui';
import { getLang, kmh, setLang, t } from './i18n';
import { LOCALES } from '../shared/i18n';
import { PRESETS, Schematic } from './sections/Layout';
import { HOLIDAY_PRESETS, isHttpUrl, SWATCHES } from './util';

const TOKEN_KEY = 'calendar-admin.setupToken';
/** README section with the Google OAuth guide (REPO_URL: web/shared/project.ts). */
export const GOOGLE_GUIDE_URL = `${REPO_URL}#connecting-google-calendar`;

/** `?setup=<token>` from the startup log: keep it for this tab only and drop it from the address bar. */
export function takeSetupToken(): string {
  let tok = '';
  try {
    const qs = new URLSearchParams(location.search);
    const fromUrl = qs.get('setup');
    if (fromUrl) {
      sessionStorage.setItem(TOKEN_KEY, fromUrl);
      qs.delete('setup');
      const rest = qs.toString();
      history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    }
    tok = sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    /* storage blocked */
  }
  return tok;
}
const forgetToken = () => {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
};

interface Place {
  name: string;
  lat: number;
  lon: number;
  timezone: string;
  cc: string;
}
interface Cal {
  name: string;
  url: string;
  kind: 'holidays' | 'generic';
}

const STEPS: { id: string; label: string; icon: IconName }[] = [
  { id: 'welcome', label: 'Bienvenida', icon: 'sparkles' },
  { id: 'password', label: 'Contraseña', icon: 'key' },
  { id: 'location', label: 'Ubicación', icon: 'globe' },
  { id: 'calendars', label: 'Calendarios', icon: 'calendar' },
  { id: 'look', label: 'Aspecto', icon: 'palette' },
  { id: 'done', label: 'Listo', icon: 'check' },
];

// "Hello" in each language, under its name in the language menu of the first step.
const HELLO: Record<Lang, string> = { es: 'Hola', en: 'Hello', pt: 'Olá', nl: 'Hallo', da: 'Hej', pl: 'Cześć' };

const browserTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};
const validTz = (tz: string) => {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const browser12h = () => {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 === true;
  } catch {
    return false;
  }
};
const browserRegion = () => {
  try {
    for (const l of navigator.languages ?? [navigator.language]) {
      const m = /-([A-Z]{2})\b/i.exec(l);
      if (m) return m[1].toUpperCase();
    }
  } catch {
    /* ignore */
  }
  return '';
};

/** Black or white text on the accent colour (WCAG relative luminance). */
function onAccent(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.45 ? '#111' : '#fff';
}

/** "Portugal", "Estados Unidos"… in the UI language. */
function regionName(cc: string, lang: Lang): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(cc) ?? '';
  } catch {
    return '';
  }
}

function StrengthMeter({ pw }: { pw: string }) {
  const score = passwordScore(pw);
  const labels = ['', t('Débil'), t('Aceptable'), t('Buena'), t('Muy buena')];
  return (
    <div class={`strength strength--${score}`} aria-live="polite">
      <div class="strength__bars" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span class={i <= score ? 'is-on' : ''} />
        ))}
      </div>
      <span class="strength__label">{pw ? labels[score] : t('Escribe una contraseña')}</span>
    </div>
  );
}

function Rule({ ok, children }: { ok: boolean; children: ComponentChildren }) {
  return (
    <li class={ok ? 'is-ok' : ''}>
      <Icon name={ok ? 'check' : 'x'} size={13} /> {children}
    </li>
  );
}

export function SetupWizard({ status: initial, onDone, onLang }: { status: SetupStatus; onDone: () => void; onLang: (l: Lang) => void }) {
  const [status, setStatus] = useState(initial);
  const [step, setStep] = useState(0);
  const [lang, setLangState] = useState<Lang>(getLang());
  const [token, setToken] = useState(() => takeSetupToken());
  const [tokenErr, setTokenErr] = useState('');
  const [checking, setChecking] = useState(false);
  // password
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwTried, setPwTried] = useState(false);
  // location
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [place, setPlace] = useState<Place | null>(null);
  const [tz, setTz] = useState(browserTz());
  const [units, setUnits] = useState<'metric' | 'imperial'>(() => (['US', 'LR', 'MM'].includes(browserRegion()) ? 'imperial' : 'metric'));
  const [h24, setH24] = useState(() => !browser12h());
  const [locTried, setLocTried] = useState(false);
  // No geocoding (offline LAN, blocked Open-Meteo): coordinates typed by hand, or no location at all.
  const [manualLoc, setManualLoc] = useState(false);
  const [latText, setLatText] = useState('');
  const [lonText, setLonText] = useState('');
  const [skipLoc, setSkipLoc] = useState(false);
  // calendars
  const [cals, setCals] = useState<Cal[]>([]);
  const [holidaysTouched, setHolidaysTouched] = useState(false);
  const [icsName, setIcsName] = useState('');
  const [icsUrl, setIcsUrl] = useState('');
  const [icsTest, setIcsTest] = useState<(TestIcsResponse & { url: string }) | null>(null);
  const [testing, setTesting] = useState(false);
  const [icsErr, setIcsErr] = useState('');
  // look
  const [screenName, setScreenName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [preset, setPreset] = useState<LayoutPreset>('bigCalendar');
  const [accent, setAccent] = useState('#ff5a4e');
  const [photos, setPhotos] = useState<'stock' | 'gallery' | 'mixed'>('stock');
  const [ambient, setAmbient] = useState<'aurora' | 'particles' | 'none'>('aurora');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  // submit
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState('');
  const [done, setDone] = useState<{ slug: string; name: string; displayPath?: string | null } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const needToken = !!status.tokenRequired && status.tokenValid !== true;
  const defaultName = t('Salón');
  const effectiveName = nameTouched ? screenName : screenName || defaultName;

  const changeLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
    onLang(l);
  };

  // Focus the first field (or the step title) whenever the step changes, for keyboard and screen-reader users.
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>('[data-autofocus]') ?? root.querySelector<HTMLElement>('h2');
    el?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [step]);

  // A valid token in the URL lets the wizard skip the "setup code" question.
  useEffect(() => {
    if (status.tokenRequired && token && status.tokenValid == null) {
      api.setupStatus(token).then((s) => setStatus(s)).catch(() => {});
    }
  }, []);

  /* ------------------------------------------------------------ validation per step */
  const pwProblem = passwordProblem(pw);
  const pwMismatch = !!pw2 && pw2 !== pw;
  const pwOk = !pwProblem && pw === pw2;
  const tzOk = validTz(tz);
  const manualLat = latText.trim() === '' ? NaN : Number(latText.replace(',', '.'));
  const manualLon = lonText.trim() === '' ? NaN : Number(lonText.replace(',', '.'));
  const manualOk = Number.isFinite(manualLat) && manualLat >= -90 && manualLat <= 90 && Number.isFinite(manualLon) && manualLon >= -180 && manualLon <= 180;

  const goto = (n: number) => setStep(Math.max(0, Math.min(STEPS.length - 1, n)));

  const next = async (e?: Event) => {
    e?.preventDefault();
    if (busy || checking) return;
    if (step === 0) {
      if (needToken) {
        if (!token.trim()) return setTokenErr(t('Escribe el código de configuración'));
        setChecking(true);
        try {
          const s = await api.setupStatus(token.trim());
          setStatus(s);
          if (!s.needsSetup) return location.reload();
          if (s.tokenValid !== true) return setTokenErr(t('Código de configuración incorrecto'));
          try {
            sessionStorage.setItem(TOKEN_KEY, token.trim());
          } catch {
            /* ignore */
          }
          setTokenErr('');
        } catch (err) {
          return setTokenErr((err as ApiError).message === 'network' ? t('No se puede conectar con el servidor') : (err as ApiError).message);
        } finally {
          setChecking(false);
        }
      }
      return goto(1);
    }
    if (step === 1) {
      setPwTried(true);
      if (!pwOk) return;
      return goto(2);
    }
    if (step === 2) {
      setLocTried(true);
      if (!tzOk) return;
      if (manualLoc && !skipLoc) {
        if (!manualOk) return;
        setPlace({ name: `${manualLat.toFixed(3)}, ${manualLon.toFixed(3)}`, lat: manualLat, lon: manualLon, timezone: tz, cc: '' });
      } else if (!place && !skipLoc) return;
      return goto(3);
    }
    if (step === 3) {
      if (icsUrl.trim()) {
        // a typed but not added feed: add it instead of silently dropping it
        if (!addIcs()) return;
      }
      return goto(4);
    }
    if (step === 4) {
      if (!effectiveName.trim()) return;
      return submit();
    }
  };
  const back = () => goto(step - 1);

  /* ------------------------------------------------------------ location */
  const search = async (e?: Event) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!q.trim()) return;
    setSearching(true);
    setSearchErr('');
    try {
      // Through this server (GET /api/admin/geocode): the wizard has no session yet, so it sends its setup token.
      const j = await api.geocode(q.trim(), lang, token.trim() || undefined);
      setResults(j.results ?? []);
    } catch (e) {
      setResults(null);
      setSearchErr((e as ApiError).status === 429 ? t('Demasiadas búsquedas seguidas. Espera unos minutos.') : t('No se pudo buscar (¿sin conexión a Internet?). Inténtalo de nuevo.'));
    } finally {
      setSearching(false);
    }
  };
  const pick = (r: GeocodeResult) => {
    const name = [r.name, r.admin1 && r.admin1 !== r.name ? r.admin1 : '', r.country].filter(Boolean).join(', ');
    const p: Place = { name, lat: r.lat, lon: r.lon, timezone: r.timezone || browserTz(), cc: (r.countryCode || '').toUpperCase() };
    setPlace(p);
    setManualLoc(false);
    setSkipLoc(false);
    setTz(p.timezone);
    setResults(null);
    setQ('');
    if (p.cc === 'US' || p.cc === 'LR' || p.cc === 'MM') setUnits('imperial');
    else if (p.cc) setUnits('metric');
    if (!holidaysTouched) {
      const hp = HOLIDAY_PRESETS.find((h) => h.cc === p.cc);
      setCals((cs) => [...cs.filter((c) => c.kind !== 'holidays'), ...(hp ? [{ name: t(hp.name), url: hp.url, kind: 'holidays' as const }] : [])]);
    }
  };

  /* ------------------------------------------------------------ calendars */
  const toggleHoliday = (url: string, name: string) => {
    setHolidaysTouched(true);
    setCals((cs) => (cs.some((c) => c.url === url) ? cs.filter((c) => c.url !== url) : [...cs, { name, url, kind: 'holidays' }]));
  };
  const addIcs = (): boolean => {
    const url = icsUrl.trim();
    if (!isHttpUrl(url, true)) {
      setIcsErr(t('URL no válida: debe empezar por https://, http:// o webcal://'));
      return false;
    }
    if (cals.some((c) => c.url === url)) {
      setIcsErr(t('Este calendario ya está en la lista'));
      return false;
    }
    if (cals.length >= 20) return false;
    const fallback = (() => {
      try {
        return new URL(url.replace(/^webcals?:/, 'https:')).hostname.replace(/^www\./, '');
      } catch {
        return t('Calendario');
      }
    })();
    setCals((cs) => [...cs, { name: icsName.trim() || fallback, url, kind: 'generic' }]);
    setIcsName('');
    setIcsUrl('');
    setIcsErr('');
    return true;
  };
  const testIcs = async () => {
    const url = icsUrl.trim();
    if (!isHttpUrl(url, true)) {
      setIcsErr(t('URL no válida: debe empezar por https://, http:// o webcal://'));
      return;
    }
    setTesting(true);
    setIcsErr('');
    try {
      const r = await api.setupTestIcs(url, token || undefined);
      setIcsTest({ ...r, url });
    } catch (err) {
      setIcsTest({ ok: false, error: (err as ApiError).message, url });
    } finally {
      setTesting(false);
    }
  };

  /* ------------------------------------------------------------ submit */
  const submit = async () => {
    setBusy(true);
    setSubmitErr('');
    const body: SetupRequest = {
      token: token.trim() || undefined,
      password: pw,
      passwordConfirm: pw2,
      language: lang,
      screenName: effectiveName.trim(),
      location: place && !skipLoc ? { name: place.name, lat: place.lat, lon: place.lon, timezone: tz } : undefined,
      timezone: tzOk ? tz : undefined,
      units,
      format24: h24,
      calendars: cals.map((c) => ({ name: c.name, url: c.url, kind: c.kind })),
      photos: { source: photos },
      layout: { preset },
      accent,
      ambient,
      theme,
    };
    try {
      const r = await api.setupComplete(body);
      forgetToken();
      setDone(r.screen);
      setPw('');
      setPw2('');
      setStep(5);
    } catch (err) {
      const ae = err as ApiError;
      if (ae.status === 409) {
        setSubmitErr(t('Esta instalación ya está configurada. Recarga la página para entrar.'));
      } else if (ae.status === 403 || ae.status === 429) {
        setStatus((s) => ({ ...s, tokenRequired: true, tokenValid: false }));
        setTokenErr(ae.status === 429 ? t('Demasiados intentos. Espera un momento.') : t('Código de configuración incorrecto'));
        setStep(0);
      } else if (ae.status === 400) {
        const details = ((ae.body as any)?.details ?? []) as { path: string; message: string }[];
        const first = details[0]?.path ?? '';
        setSubmitErr(`${t('Revisa este paso')}: ${details.map((d) => d.message).join('; ') || ae.message}`);
        if (first.startsWith('password')) setStep(1);
        else if (first.startsWith('location')) setStep(2);
        else if (first.startsWith('calendars')) setStep(3);
      } else {
        setSubmitErr(ae.message === 'network' ? t('No se puede conectar con el servidor') : ae.message);
      }
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------ render helpers */
  // Opened on the server itself (localhost): phones and other devices need this machine's LAN address instead.
  const isLocalhost = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  const lanIp = isLocalhost ? status.lanAddresses?.[0] : undefined;
  const portPart = location.port ? `:${location.port}` : '';
  const origin = lanIp ? `${location.protocol}//${lanIp}${portPart}` : location.origin;
  // Private display access (fresh installs): the Done step shows the screen's private link instead of the bare URL.
  const displayUrl = done?.displayPath ? `${origin}${done.displayPath}` : `${origin}/`;
  const privateLink = !!done?.displayPath;
  const adminUrl = `${origin}/admin/`;
  const kioskCmd = kioskInstallCommand(displayUrl);
  const now = new Date();
  const timePreview = (() => {
    try {
      return new Intl.DateTimeFormat(LOCALES[lang], {
        hour: 'numeric', minute: '2-digit', hour12: !h24, timeZone: tzOk ? tz : undefined,
      }).format(now);
    } catch {
      return '';
    }
  })();
  const cur = STEPS[step];
  const rootStyle = { '--accent': accent, '--on-accent': onAccent(accent) } as any;

  const progress = (
    <ol class="wz-progress" aria-label={t('Progreso')}>
      {STEPS.map((s, i) => (
        <li class={`${i < step ? 'is-done' : ''} ${i === step ? 'is-current' : ''}`} aria-current={i === step ? 'step' : undefined}>
          <span class="wz-progress__dot">{i < step ? <Icon name="check" size={13} /> : i + 1}</span>
          <span class="wz-progress__label">{t(s.label)}</span>
        </li>
      ))}
    </ol>
  );

  let content: ComponentChildren = null;
  let title = '';
  let lead = '';

  if (step === 0) {
    title = t('Bienvenido a Marco');
    lead = t('Un calendario familiar de pared inspirado en DAKboard que funciona en tu propio servidor: tus calendarios, fotos y ajustes se quedan en casa.');
    content = (
      <>
        <ul class="wz-features">
          <li>
            <span class="wz-features__ico">
              <Icon name="calendar" size={18} />
            </span>
            <div>
              <strong>{t('Calendarios')}</strong>
              <span>{t('Google, iCal, festivos, cumpleaños y reservas en un solo vistazo.')}</span>
            </div>
          </li>
          <li>
            <span class="wz-features__ico">
              <Icon name="cloud" size={18} />
            </span>
            <div>
              <strong>{t('Tiempo y fotos')}</strong>
              <span>{t('Previsión sin clave de API y tus fotos como fondo.')}</span>
            </div>
          </li>
          <li>
            <span class="wz-features__ico">
              <Icon name="shield" size={18} />
            </span>
            <div>
              <strong>{t('Privado')}</strong>
              <span>{t('Sin cuentas ni nube: solo tu red local.')}</span>
            </div>
          </li>
        </ul>
        <Field label={t('Idioma')}>
          <LangMenu variant="field" value={lang} onChange={changeLang} label={t('Idioma')} detail={HELLO} autofocus={!needToken} />
        </Field>
        {needToken && (
          <Field
            label={t('Código de configuración')}
            error={tokenErr || undefined}
            hint={t('Este servidor pide un código para configurarse. Está en el registro del servidor, en la línea «Open …/admin/?setup=…» (o en SETUP_TOKEN).')}
          >
            <TextInput value={token} onValue={(v) => setToken(v)} error={!!tokenErr} mono autocomplete="off" prefix={<Icon name="key" size={14} />} data-autofocus />
          </Field>
        )}
      </>
    );
  } else if (step === 1) {
    title = t('Crea la contraseña del panel');
    lead = t('Protege la configuración. La pantalla se ve sin contraseña; el panel no.');
    const showErr = pwTried || pw.length >= MIN_PASSWORD;
    content = (
      <>
        <input type="text" name="username" autocomplete="username" value="admin" hidden readOnly />
        <Field label={t('Contraseña')} error={showErr && pwProblem ? (pwProblem === 'too_common' ? t('Demasiado común o sencilla') : pwProblem === 'too_long' ? t('Máximo 200 caracteres') : t('Mínimo {n} caracteres', { n: MIN_PASSWORD })) : undefined}>
          <div class={`input-group input-group--lg ${showErr && pwProblem ? 'is-invalid' : ''}`}>
            <span class="input-group__addon">
              <Icon name="key" size={16} />
            </span>
            <input
              class="input"
              type={(showPw ? 'text' : 'password') as 'password'}
              autocomplete="new-password"
              value={pw}
              data-autofocus
              aria-describedby="wz-strength"
              onInput={(e) => setPw(e.currentTarget.value)}
            />
            <button type="button" class="input-group__btn" onClick={() => setShowPw(!showPw)} aria-label={showPw ? t('Ocultar') : t('Mostrar')} aria-pressed={showPw}>
              <Icon name={showPw ? 'eyeOff' : 'eye'} size={16} />
            </button>
          </div>
        </Field>
        <div id="wz-strength">
          <StrengthMeter pw={pw} />
        </div>
        <Field label={t('Repite la contraseña')} error={(pwTried || pw2.length >= pw.length) && pwMismatch ? t('Las contraseñas no coinciden') : pwTried && !pw2 ? t('Repite la contraseña') : undefined}>
          <div class={`input-group input-group--lg ${pwMismatch ? 'is-invalid' : ''}`}>
            <span class="input-group__addon">
              <Icon name="check" size={16} />
            </span>
            <input class="input" type={(showPw ? 'text' : 'password') as 'password'} autocomplete="new-password" value={pw2} onInput={(e) => setPw2(e.currentTarget.value)} />
          </div>
        </Field>
        <ul class="wz-rules">
          <Rule ok={[...pw].length >= MIN_PASSWORD}>{t('Al menos {n} caracteres', { n: MIN_PASSWORD })}</Rule>
          <Rule ok={!!pw && pwProblem !== 'too_common' && pwProblem !== 'too_short'}>{t('Nada obvio (password, 1234567890, qwerty…)')}</Rule>
          <Rule ok={!!pw2 && pw === pw2}>{t('Las dos coinciden')}</Rule>
        </ul>
        <p class="muted small">{t('Consejo: tres o cuatro palabras al azar son fáciles de recordar y difíciles de adivinar.')}</p>
      </>
    );
  } else if (step === 2) {
    title = t('¿Dónde está la pantalla?');
    lead = t('Para el tiempo, la zona horaria y los festivos de tu país.');
    content = (
      <>
        <Field label={t('Ciudad')} error={locTried && !place && !manualLoc && !skipLoc ? t('Busca y elige tu ciudad') : undefined} hint={searchErr ? undefined : t('Búsqueda con Open-Meteo (gratis, sin clave).')}>
          <div class="search-row">
            <TextInput
              value={q}
              onValue={setQ}
              placeholder={t('Buscar ciudad…')}
              prefix={<Icon name="search" size={14} />}
              data-autofocus
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void search();
                }
              }}
            />
            <Button onClick={() => search()} loading={searching}>
              {t('Buscar')}
            </Button>
          </div>
          {searchErr && <div class="field__error">{searchErr}</div>}
          {results && (
            <div class="geo-results" role="listbox" aria-label={t('Resultados')}>
              {results.length === 0 && <div class="muted small">{t('Sin resultados')}</div>}
              {results.map((r) => (
                <button type="button" class="geo-result" onClick={() => pick(r)}>
                  <Icon name="pin" size={14} />
                  <span>
                    <strong>{r.name}</strong>
                    <span class="muted">{[r.admin1, r.country].filter(Boolean).join(', ')}</span>
                  </span>
                  <span class="muted small mono">{r.timezone}</span>
                </button>
              ))}
            </div>
          )}
        </Field>
        {!place && (
          <div class="wz-localt">
            <button type="button" class="link-btn" aria-expanded={manualLoc} onClick={() => { setManualLoc(!manualLoc); setSkipLoc(false); }}>
              {t('Escribir las coordenadas')}
            </button>
            <span class="muted" aria-hidden="true">·</span>
            <button type="button" class="link-btn" aria-pressed={skipLoc} onClick={() => { setSkipLoc(!skipLoc); setManualLoc(false); }}>
              {skipLoc ? t('Elegir una ubicación') : t('Omitir (configurarla más tarde)')}
            </button>
          </div>
        )}
        {skipLoc && !place && <Callout kind="info">{t('Sin ubicación no hay previsión del tiempo; añádela cuando quieras en Tiempo. La zona horaria de abajo se guarda igualmente.')}</Callout>}
        {manualLoc && !place && (
          <div class="grid grid--2">
            <Field label={t('Latitud')} error={locTried && !manualOk ? t('Entre -90 y 90') : undefined}>
              <TextInput value={latText} onValue={setLatText} mono placeholder="38.7223" inputMode="decimal" />
            </Field>
            <Field label={t('Longitud')} error={locTried && !manualOk ? t('Entre -180 y 180') : undefined}>
              <TextInput value={lonText} onValue={setLonText} mono placeholder="-9.1393" inputMode="decimal" />
            </Field>
          </div>
        )}
        {place && (
          <div class="wz-place">
            <span class="wz-place__pin">
              <Icon name="pin" size={18} />
            </span>
            <div>
              <strong>{place.name}</strong>
              <div class="muted small mono">
                {place.lat.toFixed(3)}, {place.lon.toFixed(3)}
              </div>
            </div>
          </div>
        )}
        <div class="grid grid--2">
          <Field label={t('Zona horaria')} error={!tzOk ? t('Zona horaria no válida') : undefined} hint={t('Detectada automáticamente; cámbiala si hace falta.')}>
            <TextInput value={tz} onValue={setTz} mono prefix={<span>🌍</span>} error={!tzOk} />
          </Field>
          <Field label={t('Hora en la pantalla')}>
            <div class="wz-timeprev">{timePreview}</div>
          </Field>
        </div>
        <div class="grid grid--2">
          <Field label={t('Temperatura')}>
            <Segmented
              full
              value={units}
              options={[
                { value: 'metric', label: `°C · ${kmh()}` },
                { value: 'imperial', label: '°F · mph' },
              ]}
              onChange={setUnits}
            />
          </Field>
          <Field label={t('Formato de hora')}>
            <Segmented
              full
              value={h24 ? '24' : '12'}
              options={[
                { value: '24', label: '24 h' },
                { value: '12', label: '12 h (AM/PM)' },
              ]}
              onChange={(v) => setH24(v === '24')}
            />
          </Field>
        </div>
      </>
    );
  } else if (step === 3) {
    title = t('Tus calendarios');
    lead = t('Empieza con los festivos y los calendarios que ya tengas. Podrás añadir más cuando quieras.');
    const holidayUrls = new Set(cals.filter((c) => c.kind === 'holidays').map((c) => c.url));
    const others = cals.filter((c) => !HOLIDAY_PRESETS.some((h) => h.url === c.url));
    content = (
      <>
        <Field label={t('Festivos')} hint={t('Calendarios públicos de Google, por país.')}>
          <div class="wz-chips">
            {HOLIDAY_PRESETS.map((h, i) => (
              <button
                type="button"
                class={`wz-chip ${holidayUrls.has(h.url) ? 'is-active' : ''}`}
                aria-pressed={holidayUrls.has(h.url)}
                onClick={() => toggleHoliday(h.url, t(h.name))}
                {...(i === 0 ? { 'data-autofocus': true } : {})}
              >
                <span aria-hidden="true">{h.flag}</span> {regionName(h.cc, lang) || t(h.name)}
                {holidayUrls.has(h.url) && <Icon name="check" size={13} />}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('Añadir un calendario iCal (.ics)')} error={icsErr || undefined} hint={icsErr ? undefined : t('Dirección secreta de Google Calendar, Outlook, iCloud, el colegio, Airbnb…')}>
          <div class="wz-ics">
            <TextInput value={icsName} onValue={setIcsName} placeholder={t('Nombre (opcional)')} maxLength={80} />
            <TextInput
              value={icsUrl}
              onValue={(v) => {
                setIcsUrl(v);
                setIcsErr('');
              }}
              placeholder="https://…/basic.ics"
              mono
              error={!!icsErr}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addIcs();
                }
              }}
            />
            <div class="wz-ics__btns">
              <Button icon="zap" onClick={testIcs} loading={testing} disabled={!icsUrl.trim()}>
                {t('Probar')}
              </Button>
              <Button icon="plus" variant="primary" onClick={() => addIcs()} disabled={!icsUrl.trim()}>
                {t('Añadir')}
              </Button>
            </div>
          </div>
          {icsTest && icsTest.url === icsUrl.trim() && (
            <div class={`wz-test ${icsTest.ok ? 'is-ok' : 'is-err'}`} role="status">
              <Icon name={icsTest.ok ? 'check' : 'alert'} size={14} />
              {icsTest.ok ? (
                <span>
                  {t('Funciona: {n} eventos en los próximos meses', { n: icsTest.count ?? 0 })}
                  {icsTest.sample?.length ? <span class="muted"> · {icsTest.sample.slice(0, 3).join(' · ')}</span> : null}
                </span>
              ) : (
                <span>
                  {t('No se pudo leer')}: {icsTest.error}
                </span>
              )}
            </div>
          )}
        </Field>
        {cals.length > 0 && (
          <ul class="wz-cal-list">
            {cals.map((c) => (
              <li>
                <span>{c.kind === 'holidays' ? '🎉' : '📅'}</span>
                <div>
                  <strong>{c.name}</strong>
                  <span class="muted small mono">{c.url}</span>
                </div>
                <button
                  type="button"
                  class="btn btn--ghost btn--icon btn--sm"
                  aria-label={t('Quitar {name}', { name: c.name })}
                  onClick={() => {
                    if (c.kind === 'holidays') setHolidaysTouched(true);
                    setCals((cs) => cs.filter((x) => x.url !== c.url));
                  }}
                >
                  <Icon name="x" size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {others.length === 0 && cals.length === 0 && <p class="muted small">{t('Sin calendarios por ahora: también puedes añadirlos después.')}</p>}
        <div class="wz-google">
          <Icon name="google" size={18} />
          {status.googleConfigured ? (
            <div>
              <strong>{t('Google Calendar')}</strong>
              <p>{t('Google está configurado en este servidor: vincula tu cuenta después, en Calendarios → Google, y elige qué calendarios mostrar.')}</p>
            </div>
          ) : (
            <div>
              <strong>{t('Google Calendar')}</strong>
              <p>{t('Lo más rápido: en Google Calendar abre Configuración → tu calendario → «Dirección secreta en formato iCal» y pégala arriba.')}</p>
              <p>
                {t('Para vincular la cuenta (y entrar con Google) hace falta un cliente OAuth propio: GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el .env.')}{' '}
                <a href={GOOGLE_GUIDE_URL} target="_blank" rel="noopener noreferrer">
                  {t('Guía paso a paso')} <Icon name="external" size={12} />
                </a>
              </p>
            </div>
          )}
        </div>
      </>
    );
  } else if (step === 4) {
    title = t('Dale tu estilo');
    lead = t('Todo se puede cambiar después en el panel.');
    content = (
      <>
        <Field label={t('Nombre de la pantalla')} hint={t('Por ejemplo: Salón, Cocina, Entrada.')} error={nameTouched && !screenName.trim() ? t('Escribe un nombre') : undefined}>
          <TextInput
            value={nameTouched ? screenName : screenName || defaultName}
            onValue={(v) => {
              setNameTouched(true);
              setScreenName(v);
            }}
            maxLength={40}
            prefix={<Icon name="monitor" size={14} />}
            data-autofocus
          />
        </Field>
        <Field label={t('Diseño')}>
          <div class="wz-presets" role="radiogroup" aria-label={t('Diseño')}>
            {PRESETS.filter((p) => p.wizard).map((p) => (
              <button type="button" role="radio" aria-checked={preset === p.id} class={`preset ${preset === p.id ? 'is-active' : ''}`} onClick={() => setPreset(p.id)} title={t(p.desc)}>
                <Schematic id={p.id} side="left" />
                <div class="preset__text">
                  <div class="preset__name">
                    <span class="radio-dot" />
                    {t(p.name)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Field>
        <div class="grid grid--2">
          <Field label={t('Color de acento')}>
            <div class="wz-swatches" role="radiogroup" aria-label={t('Color de acento')}>
              {SWATCHES.slice(0, 10).map((c) => (
                <button type="button" role="radio" aria-checked={accent === c} aria-label={c} class={`swatch swatch--lg ${accent === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => setAccent(c)} />
              ))}
            </div>
          </Field>
          <Field label={t('Tema')}>
            <Segmented
              full
              value={theme}
              options={[
                { value: 'dark', label: t('Oscuro'), icon: 'moon' },
                { value: 'light', label: t('Claro'), icon: 'sun' },
              ]}
              onChange={setTheme}
            />
          </Field>
        </div>
        <Field label={t('Fotos de fondo')} hint={photos === 'stock' ? t('Fotos de paisajes de stock, listas desde el primer minuto.') : t('Sube tus fotos después en Galería (también desde el móvil).')}>
          <Segmented
            full
            value={photos}
            options={[
              { value: 'stock', label: t('Stock'), icon: 'globe' },
              { value: 'gallery', label: t('Mi galería'), icon: 'photos' },
              { value: 'mixed', label: t('Mezcla'), icon: 'sparkles' },
            ]}
            onChange={setPhotos}
          />
        </Field>
        <Field label={t('Efecto ambiental')}>
          <div class="fx-grid">
            {(
              [
                { v: 'aurora', name: t('Aurora'), desc: t('Velos de color suaves que se mueven lentamente.') },
                { v: 'particles', name: t('Partículas'), desc: t('Polvo de luz flotando con profundidad.') },
                { v: 'none', name: t('Ninguno'), desc: t('Máximo rendimiento, sin WebGL.') },
              ] as const
            ).map((o) => (
              <button type="button" aria-pressed={ambient === o.v} class={`fx ${ambient === o.v ? 'is-active' : ''}`} onClick={() => setAmbient(o.v)}>
                <span class={`fx__swatch fx__swatch--${o.v}`} />
                <strong>{o.name}</strong>
                <small>{o.desc}</small>
              </button>
            ))}
          </div>
        </Field>
        {submitErr && <Callout kind="error">{submitErr}</Callout>}
      </>
    );
  } else if (done) {
    title = t('¡Todo listo!');
    lead = privateLink
      ? t('Abre este enlace privado en la tele, la Raspberry Pi o una tablet: es la llave de esta pantalla, no lo publiques. Los cambios del panel aparecen en la pantalla al instante.')
      : t('Abre esta dirección en la tele, la Raspberry Pi o una tablet. Los cambios del panel aparecen en la pantalla al instante.');
    const sumRows: [IconName, string, string][] = [
      ['monitor', t('Pantalla'), done.name],
      ['globe', t('Ubicación'), place && !skipLoc ? `${place.name} · ${tz}` : tz],
      ['calendar', t('Calendarios'), cals.length ? cals.map((c) => c.name).join(', ') : t('Ninguno (añádelos en Calendarios)')],
      ['layout', t('Diseño'), t(PRESETS.find((p) => p.id === preset)?.name ?? preset)],
      ['photos', t('Fotos de fondo'), photos === 'stock' ? t('Stock') : photos === 'gallery' ? t('Mi galería') : t('Mezcla')],
    ];
    content = (
      <>
        <div class="wz-done">
          <div class="wz-done__qr">
            <Qr text={displayUrl} label={privateLink ? t('Código QR del enlace privado') : t('Código QR de la dirección de la pantalla')} />
            <span class="muted small">{t('Escanéalo con el móvil')}</span>
          </div>
          <div class="wz-done__main">
            <Field
              label={privateLink ? t('Enlace privado de la pantalla') : t('Dirección de la pantalla')}
              hint={privateLink ? t('¿Otra pantalla? Abre {url} en ella y vincúlala con el código que muestra (Pantallas conectadas → Vincular).', { url: `${origin}/` }) : undefined}
            >
              <CopyField value={displayUrl} />
            </Field>
            {isLocalhost && !lanIp && <Callout kind="warn">{t('Estás en «localhost»: en otros dispositivos usa la IP de este ordenador (p. ej. {url}).', { url: `http://192.168.1.50${portPart}/` })}</Callout>}
            <Field label={t('Panel de administración')}>
              <CopyField value={adminUrl} />
            </Field>
          </div>
        </div>
        <ul class="wz-summary">
          {sumRows.map(([icon, k, v]) => (
            <li>
              <Icon name={icon} size={15} />
              <span class="muted">{k}</span>
              <strong>{v}</strong>
            </li>
          ))}
        </ul>
        <div class="wz-tips">
          <h3>{t('Consejos')}</h3>
          <ul>
            <li>
              <Icon name="zap" size={14} />
              <span>
                {t('¿Raspberry Pi 3 o una tablet antigua? Añade')} <code>?lite=1</code> {t('a la dirección (sin efectos WebGL).')}
              </span>
            </li>
            <li>
              <Icon name="monitor" size={14} />
              <div>
                {t('Raspberry Pi solo como pantalla (el servidor está en otro equipo):')}
                <CopyField value={kioskCmd} />
              </div>
            </li>
            {photos !== 'stock' && (
              <li>
                <Icon name="photos" size={14} />
                <span>{t('Sube tus fotos en Galería.')}</span>
              </li>
            )}
            {status.googleConfigured && (
              <li>
                <Icon name="google" size={14} />
                <span>{t('Vincula Google Calendar en Calendarios → Google.')}</span>
              </li>
            )}
          </ul>
        </div>
      </>
    );
  }

  return (
    <div class="wizard" style={rootStyle}>
      <div class="login__bg" aria-hidden="true">
        <span class="blob blob--a" />
        <span class="blob blob--b" />
        <span class="blob blob--c" />
      </div>
      <header class="wz-top">
        <div class="wz-brand">
          <BrandMark size={36} />
          <span>Marco</span>
        </div>
        <span class="wz-top__step">{t('Paso {n} de {total}', { n: step + 1, total: STEPS.length })}</span>
        {step > 0 && step < 5 && (
          <div class="wz-top__lang">
            <LangMenu value={lang} onChange={changeLang} label={t('Idioma')} align="end" />
          </div>
        )}
      </header>
      {progress}
      <form class="wz-card" onSubmit={next} noValidate key={step}>
        <div class="wz-card__body" ref={bodyRef}>
          <div class="wz-head">
            <span class="wz-head__ico" aria-hidden="true">
              <Icon name={cur.icon} size={20} />
            </span>
            <div>
              <h2 tabIndex={-1}>{title}</h2>
              <p>{lead}</p>
            </div>
          </div>
          <div class="stack">{content}</div>
        </div>
        <footer class="wz-nav">
          {step > 0 && step < 5 ? (
            <Button icon="up" class="wz-back" onClick={back} disabled={busy}>
              {t('Atrás')}
            </Button>
          ) : (
            <span />
          )}
          {step < 4 && (
            <Button type="submit" variant="primary" loading={checking}>
              {t('Siguiente')}
            </Button>
          )}
          {step === 4 && (
            <Button type="submit" variant="primary" icon="check" loading={busy}>
              {t('Terminar')}
            </Button>
          )}
          {step === 5 && (
            <div class="wz-nav__end">
              <a class="btn btn--default" href={displayUrl} target="_blank" rel="noopener">
                <Icon name="external" size={16} />
                <span>{t('Abrir la pantalla')}</span>
              </a>
              <Button variant="primary" icon="settings" onClick={onDone}>
                {t('Ir al panel')}
              </Button>
            </div>
          )}
        </footer>
      </form>
      <p class="wz-foot muted small">
        {t('Marco v{v} · código abierto (MIT) · inspirado en DAKboard, sin relación con él', { v: status.version })}
      </p>
    </div>
  );
}
