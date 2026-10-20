import { useEffect, useState } from 'preact/hooks';
import type { DashboardResponse, NightCommand } from '../../shared/types';
import { actorLabel, describeActivity } from '../activityText';
import { api, ApiError } from '../api';
import { fetchErrorText } from '../apiErrors';
import { AnnounceForm } from '../components/AnnounceForm';
import { toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { WelcomeCard } from '../components/WelcomeCard';
import { PrivacyActions, PrivacyMenu, privacyUntilText, usePrivacy } from '../components/Privacy';
import { Button, Callout, Card, Empty, StatusDot } from '../components/ui';
import { daysBetween, eventDay, eventTimeLabel, fmtDay, relDays, todayIn } from '../dates';
import { has, runtime } from '../caps';
import { screenHref, useDisplayLinks } from '../displayLinks';
import { formatDuration, kmh, locale, nScreens, relTime, t } from '../i18n';
import { withPollNote } from '../liveNote';
import { greetingName, sourceRowName } from '../util';
import type { SectionProps } from './common';

const WMO: Record<number, string> = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️', 51: '🌦️', 53: '🌦️', 55: '🌧️', 56: '🌧️', 57: '🌧️', 61: '🌦️', 63: '🌧️', 65: '🌧️',
  66: '🌧️', 67: '🌧️', 71: '🌨️', 73: '🌨️', 75: '❄️', 77: '🌨️', 80: '🌦️', 81: '🌧️', 82: '⛈️', 85: '🌨️', 86: '❄️', 95: '⛈️', 96: '⛈️', 99: '⛈️',
};
const wmoEmoji = (code: number, day: boolean) => (code <= 1 && !day ? '🌙' : WMO[code] ?? '🌡️');

function greeting(name: string) {
  const h = new Date().getHours();
  const g = h < 6 ? t('Buenas noches') : h < 13 ? t('Buenos días') : h < 20 ? t('Buenas tardes') : t('Buenas noches');
  return name ? `${g}, ${name}` : g;
}

const WARN_TEXT: Record<string, { text: string; route: string; kind: 'warn' | 'error' | 'info' }> = {
  default_password: { text: 'Estás usando la contraseña inicial. Cámbiala en Seguridad.', route: 'security', kind: 'error' },
  env_password: { text: 'La contraseña viene de ADMIN_PASSWORD. Te recomendamos cambiarla en Seguridad.', route: 'security', kind: 'info' },
  display_access_open: { text: 'Las pantallas están en modo abierto: cualquiera que llegue a este servidor puede ver el calendario sin clave. Recomendado: enlaces privados y vinculación.', route: 'security/sec-display', kind: 'warn' },
  source_errors: { text: 'Hay calendarios con errores de descarga.', route: 'status', kind: 'warn' },
  no_displays: { text: 'Ninguna pantalla conectada ahora mismo.', route: 'displays', kind: 'info' },
  outdated_displays: { text: 'Alguna pantalla ejecuta una versión antigua: recárgala.', route: 'displays', kind: 'warn' },
  google_auth_failed: { text: 'Una cuenta de Google ha perdido el acceso. Vuelve a vincularla.', route: 'calendars', kind: 'error' },
  microsoft_auth_failed: { text: 'Una cuenta de Microsoft ha perdido el acceso. Vuelve a vincularla.', route: 'calendars', kind: 'error' },
  spotify_auth_failed: { text: 'Una cuenta de Spotify ha perdido el acceso. Vuelve a conectarla.', route: 'spotify', kind: 'error' },
  spotify_app_refused: { text: 'Spotify no acepta el Client Secret de tu app. Revísalo en la página Spotify.', route: 'spotify', kind: 'error' },
};

export function HomeSection({ me, full, go, setScreenId, cfg, saved }: SectionProps) {
  const [dash, setDash] = useState<DashboardResponse | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const cmdsOn = has('displayCommands');
  const annOn = has('announcements');
  const privOn = has('privacy');
  const privacy = usePrivacy();
  const links = useDisplayLinks(saved);
  const [, tick] = useState(0);
  const [welcome, setWelcome] = useState(false);

  const load = async () => {
    try {
      setDash(await api.dashboard());
      setErr('');
    } catch (e) {
      setErr((e as ApiError).message);
    }
  };
  useEffect(() => {
    load();
    const a = setInterval(load, 20000);
    const b = setInterval(() => tick((n) => n + 1), 30000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const cmd = async (key: string, fn: () => Promise<{ delivered?: number } | unknown>, ok: string) => {
    setBusy(key);
    try {
      const r = (await fn()) as { delivered?: number; displays?: number } | undefined;
      const n = r?.delivered ?? r?.displays;
      toast(n != null ? (n ? withPollNote(`${ok} · ${nScreens(n)}`) : `${ok} · ${nScreens(n)}`) : withPollNote(ok), n === 0 ? 'info' : 'ok');
      setTimeout(load, 1500);
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy('');
    }
  };
  const night = (mode: NightCommand) =>
    cmd(`night-${mode}`, () => api.displayCommand({ action: 'night', mode }), mode === 'on' ? t('Modo noche activado') : mode === 'off' ? t('Modo noche desactivado') : t('Modo noche automático'));

  const tz = cfg.datetime.timezone;
  const today = todayIn(tz);
  const firstName = greetingName(me.user?.name);
  const d = dash;
  const screens = d?.screens ?? full.screens.map((s) => ({ id: s.id, slug: s.slug, name: s.name, isDefault: s.id === full.defaultScreen, displaysOnline: 0 }));
  const online = d?.displays.filter((x) => x.connected).length ?? 0;
  const srcErr = d?.sources.filter((s) => s.enabled !== false && !s.ok && s.lastFetch) ?? [];
  const dateLabel = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date());

  return (
    <>
      <div class="hero">
        <div>
          <h1>{greeting(firstName)}</h1>
          <p class="muted">
            {dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}
            {d && (
              <>
                {' · '}
                {t('servidor v{v}', { v: d.version })}
                {d.uptime != null && runtime() !== 'workers' && <> · {t('activo {d}', { d: formatDuration(d.uptime) })}</>}
              </>
            )}
          </p>
        </div>
        <div class="hero__stats">
          <button type="button" class="hero__stat" onClick={() => go('displays')}>
            <strong>{d ? online : '–'}</strong>
            <span>{t('conectadas')}</span>
          </button>
          <button type="button" class="hero__stat" onClick={() => go('screens')}>
            <strong>{full.screens.length}</strong>
            <span>{full.screens.length === 1 ? t('pantalla') : t('pantallas')}</span>
          </button>
          <button type="button" class="hero__stat" onClick={() => go('status')}>
            <strong class={srcErr.length ? 'err-text' : ''}>{d ? `${d.sources.filter((s) => s.ok).length}/${d.sources.length}` : '–'}</strong>
            <span>{t('calendarios OK')}</span>
          </button>
        </div>
      </div>

      <WelcomeCard me={me} dash={d} go={go} onShown={setWelcome} />

      {err && !d && <Callout kind="error">{t('No se pudo cargar el resumen')}: {err}</Callout>}
      {d?.warnings.map((w) => {
        const info = WARN_TEXT[w];
        // The welcome card already says how to put the screen on a TV.
        if (!info || (welcome && w === 'no_displays')) return null;
        return (
          <button type="button" class={`warn-row warn-row--${info.kind}`} onClick={() => go(info.route)}>
            <Icon name={info.kind === 'info' ? 'info' : 'alert'} size={16} />
            <span>{t(info.text)}</span>
            <Icon name="down" size={14} class="warn-row__go" />
          </button>
        );
      })}

      {(cmdsOn || annOn || privOn) && (
        <Card title={t('Acciones rápidas')} icon="zap">
          {cmdsOn && (
            <>
              <div class="quick-actions">
                <Button icon="refresh" loading={busy === 'reload'} onClick={() => cmd('reload', () => api.refreshDisplays(), t('Pantallas recargándose…'))}>
                  {t('Refrescar pantallas')}
                </Button>
                <Button icon="target" loading={busy === 'identify'} onClick={() => cmd('identify', () => api.displayCommand({ action: 'identify' }), t('Identificando pantallas'))}>
                  {t('Identificar')}
                </Button>
                <div class="btn-group" role="group" aria-label={t('Modo noche')}>
                  <Button icon="moon" loading={busy === 'night-on'} onClick={() => night('on')} title={t('Modo noche ahora en todas las pantallas')}>
                    {t('Noche')}
                  </Button>
                  <Button icon="sun" loading={busy === 'night-off'} onClick={() => night('off')} title={t('Quitar el modo noche ahora')}>
                    {t('Día')}
                  </Button>
                  <Button icon="clock" loading={busy === 'night-auto'} onClick={() => night('auto')} title={t('Volver al horario automático')}>
                    {t('Auto')}
                  </Button>
                </div>
              </div>
              {(annOn || privOn) && <div class="divider-line" />}
            </>
          )}
          {privOn && (
            <>
              <div class="quick-privacy">
                <div class="quick-privacy__label">
                  <Icon name="lock" size={15} />
                  <strong>{t('Modo privado')}</strong>
                  <span class="muted small">{full.screens.length > 1 ? t('en todas las pantallas') : t('en la pantalla')}</span>
                </div>
                <PrivacyActions active={!!privacy?.some((r) => r.active)} />
              </div>
              {annOn && <div class="divider-line" />}
            </>
          )}
          {annOn && <AnnounceForm compact screens={saved.screens} onSent={() => setTimeout(load, 800)} />}
        </Card>
      )}

      <div class="dash-grid">
        <div class="dash-col">
          <Card
            class="dash-o1"
            title={t('Pantallas')}
            icon="monitor"
            actions={
              <Button size="sm" variant="ghost" onClick={() => go('displays')}>
                {t('Ver conectadas')}
              </Button>
            }
          >
            <ul class="dash-screens">
              {screens.map((s) => {
                const prof = full.screens.find((p) => p.id === s.id);
                const ds = d?.displays.filter((x) => x.screenId === s.id) ?? [];
                const on = ds.filter((x) => x.connected).length;
                const priv = privacy?.find((r) => r.screenId === s.id);
                return (
                  <li>
                    <span class="dash-screens__sw" style={{ background: prof?.screen.accent ?? 'var(--accent)' }} />
                    <div class="dash-screens__main">
                      <strong>
                        {s.name} {s.isDefault && <span class="star" title={t('Pantalla predeterminada')}>★</span>}
                      </strong>
                      {saved.security?.displayAccess === 'open' && <span class="muted small mono">?screen={s.slug}</span>}
                      {priv?.active && (
                        <span class="privacy-pill" title={privacyUntilText(priv, tz)}>
                          <Icon name="lock" size={12} /> {t('Privado')}
                        </span>
                      )}
                    </div>
                    <span class={`online-pill ${on ? 'is-on' : ''}`}>
                      <StatusDot state={on ? 'ok' : 'idle'} /> {on ? t('{n} en línea', { n: on }) : t('sin conexión')}
                    </span>
                    <PrivacyMenu screenId={s.id} row={priv} tz={tz} />
                    <button
                      type="button"
                      class="icon-btn"
                      title={t('Editar esta pantalla')}
                      onClick={() => {
                        setScreenId(s.id);
                        go('layout');
                      }}
                    >
                      <Icon name="edit" size={15} />
                    </button>
                    {screenHref(saved, s.id, links) && (
                      <a class="icon-btn" href={screenHref(saved, s.id, links)!} target="_blank" rel="noopener" title={t('Abrir pantalla')}>
                        <Icon name="external" size={15} />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card
            class="dash-o3"
            title={t('Próximos eventos')}
            icon="calendar"
            actions={
              <Button size="sm" variant="ghost" onClick={() => go('filters')}>
                {t('Filtrar')}
              </Button>
            }
          >
            {!d ? (
              <div class="skeleton-list">
                <div class="skeleton" />
                <div class="skeleton" />
                <div class="skeleton" />
              </div>
            ) : d.nextEvents.length === 0 ? (
              <Empty icon="calendar" title={t('Nada en los próximos 7 días')} />
            ) : (
              <ul class="ev-list">
                {d.nextEvents.map((e, i) => {
                  const day = eventDay(e);
                  const prev = i > 0 ? eventDay(d.nextEvents[i - 1]) : '';
                  const n = daysBetween(today, day);
                  return (
                    <>
                      {day !== prev && <li class="ev-list__day">{n <= 1 && n >= 0 ? relDays(n) : fmtDay(day)}</li>}
                      <li class="ev-list__ev" style={{ '--ev': e.color } as any}>
                        <span class="ev-list__emoji">{e.emoji || '•'}</span>
                        <span class="ev-list__title">
                          {e.title}
                          {e.age != null && ` (${e.age})`}
                        </span>
                        <span class="ev-list__time muted small">{eventTimeLabel(e)}</span>
                      </li>
                    </>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card
            class="dash-o6"
            title={t('Actividad reciente')}
            icon="history"
            actions={
              <Button size="sm" variant="ghost" onClick={() => go('activity')}>
                {t('Ver todo')}
              </Button>
            }
          >
            {!d ? (
              <div class="skeleton" />
            ) : d.activity.length === 0 ? (
              <div class="muted small">{t('Sin actividad registrada.')}</div>
            ) : (
              <ul class="act-mini">
                {d.activity.map((a) => {
                  const x = describeActivity(a);
                  return (
                    <li class={`act-mini__i act--${a.level}`}>
                      <span class="act-mini__icon">
                        <Icon name={x.icon} size={13} />
                      </span>
                      <span class="act-mini__text">{x.text}</span>
                      <span class="muted small act-mini__meta" title={`${actorLabel(a.actor)} · ${a.ts}`}>
                        {relTime(a.ts)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
        <div class="dash-col">
          <Card class="dash-o2" title={t('Tiempo ahora')} icon="cloud">
            {!d ? (
              <div class="skeleton" />
            ) : !d.weather ? (
              <Empty icon="cloud" title={t('Sin datos del tiempo todavía')}>
                {t('Se descargan cuando una pantalla los pide.')}
              </Empty>
            ) : (
              <div class="wx-now">
                <span class="wx-now__icon">{wmoEmoji(d.weather.code, d.weather.isDay)}</span>
                <div>
                  <div class="wx-now__temp">{Math.round(d.weather.temp)}°</div>
                  <div class="muted small">{d.weather.description}</div>
                </div>
                <div class="wx-now__meta">
                  <strong>{d.weather.locationName}</strong>
                  <span class="muted small">
                    ↓ {Math.round(d.weather.min)}° · ↑ {Math.round(d.weather.max)}°
                    {d.weather.humidity != null && <> · 💧 {d.weather.humidity}%</>}
                    {d.weather.windKmh != null && <> · 💨 {Math.round(d.weather.windKmh)} {kmh()}</>}
                  </span>
                  <span class="muted small">
                    {t('Actualizado {when}', { when: relTime(d.weather.updatedAt) })}
                    {' · '}
                    {t('Datos de {source}', { source: [d.weather.source?.name ?? 'Open-Meteo', d.weather.source?.modelName].filter(Boolean).join(' · ') })}
                  </span>
                </div>
              </div>
            )}
          </Card>

          <Card
            class="dash-o4"
            title={t('Salud de los calendarios')}
            icon="activity"
            actions={
              <Button size="sm" variant="ghost" onClick={() => go('status')}>
                {t('Detalles')}
              </Button>
            }
          >
            {!d ? (
              <div class="skeleton" />
            ) : d.sources.length === 0 ? (
              <Empty icon="calendar" title={t('No hay calendarios configurados')} />
            ) : (
              <ul class="health-list">
                {d.sources.map((s) => {
                  const meta = full.calendar.sources.find((x) => x.id === s.id);
                  const color = meta?.color ?? (s.id === 'birthdays' ? full.birthdays.color : s.id === 'local' ? full.localEvents.color : '#888');
                  const state = s.enabled === false ? 'idle' : s.ok ? 'ok' : s.lastFetch ? 'error' : 'idle';
                  return (
                    <li title={s.error ?? ''}>
                      <StatusDot state={state} />
                      <span class="dot-color" style={{ background: color }} />
                      <span class="health-list__name">{sourceRowName(full, s.id, s.name)}</span>
                      <span class={`small ${s.ok ? 'muted' : 'err-text'}`}>{s.ok ? t('{n} eventos', { n: s.count }) : s.enabled === false ? t('Desactivado') : fetchErrorText(s.error) || t('Pendiente')}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card
            class="dash-o5"
            title={t('Avisos')}
            icon="megaphone"
            actions={
              <Button size="sm" variant="ghost" onClick={() => go('alerts')}>
                {t('Gestionar')}
              </Button>
            }
          >
            {!d ? (
              <div class="skeleton" />
            ) : d.announcements.length === 0 && d.schedulesNow.length === 0 ? (
              <div class="muted small">{t('No hay avisos activos ni mensajes programados en este momento.')}</div>
            ) : (
              <ul class="mini-alerts">
                {d.announcements.map((a) => (
                  <li class={`mini-alerts__a mini-alerts__a--${a.style}`}>
                    <span>{a.emoji || '🔔'}</span>
                    <strong>{a.title || a.body}</strong>
                    <span class="muted small">{t('hasta {time}', { time: new Date(a.expiresAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })}</span>
                  </li>
                ))}
                {d.schedulesNow.map((s) => (
                  <li class="mini-alerts__a mini-alerts__a--sched">
                    <span>{s.emoji || '🗓️'}</span>
                    <strong>{s.title}</strong>
                    <span class="muted small">{t('programado · hasta {time}', { time: new Date(s.until).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
