import { useEffect, useRef, useState } from 'preact/hooks';
import type { DisplayInfo, DisplaysResponse, NightCommand, StoredConfig } from '../../shared/types';
import { carouselBlock, carouselPhase } from '../../shared/carousels';
import { api, ApiError } from '../api';
import { confirmDialog, toast } from '../components/feedback';
import { OpenModeCallout, openPairDialog, PairedDevicesCard } from '../components/DisplayAccess';
import { Icon } from '../components/icons';
import { Button, Callout, Card, Empty, PageHeader, StatusDot } from '../components/ui';
import { fmtDateTime } from '../dates';
import { has } from '../caps';
import { screenHref, useDisplayLinks } from '../displayLinks';
import { formatDuration, relTime, nScreens, t } from '../i18n';
import { withPollNote } from '../liveNote';
import type { SectionProps } from './common';
import { PrivacyMenu, usePrivacy } from '../components/Privacy';

function NightMenu({ value, onPick, busy }: { value: NightCommand | null; onPick: (m: NightCommand) => void; busy?: boolean }) {
  const opts: { v: NightCommand; icon: 'moon' | 'sun' | 'clock'; label: string }[] = [
    { v: 'on', icon: 'moon', label: t('Noche') },
    { v: 'off', icon: 'sun', label: t('Día') },
    { v: 'auto', icon: 'clock', label: t('Auto') },
  ];
  return (
    <div class={`seg seg--sm night-seg ${busy ? 'is-disabled' : ''}`} role="radiogroup" aria-label={t('Modo noche')} style={{ '--seg-n': 3, '--seg-i': Math.max(0, opts.findIndex((o) => o.v === (value ?? 'auto'))) } as any}>
      <span class="seg__thumb" aria-hidden="true" />
      {opts.map((o) => (
        <button type="button" role="radio" aria-checked={(value ?? 'auto') === o.v} class={(value ?? 'auto') === o.v ? 'is-active' : ''} title={o.label} onClick={() => onPick(o.v)}>
          <Icon name={o.icon} size={14} />
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Screen a display on a carousel shows now: what the carousel's clock says (the same rule the TVs follow, with the
 * night hold when the display reports night mode), else the screen its last heartbeat named.
 */
export function carouselShowing(saved: StoredConfig, d: DisplayInfo): string {
  const c = saved.carousels?.items.find((x) => x.id === d.screenId);
  if (!c) return d.showingScreenName ?? '';
  const block = carouselBlock(saved, c);
  const ph = carouselPhase(block, Date.now(), { tz: saved.datetime.timezone, night: d.night === true });
  return saved.screens.find((s) => s.id === ph.screenId)?.name ?? d.showingScreenName ?? '';
}

function DisplayCard({ d, saved, serverVersion, onCmd, onForget, busy }: { d: DisplayInfo; saved: StoredConfig; serverVersion: string; onCmd: (action: 'reload' | 'identify' | 'night', mode?: NightCommand) => void; onForget: () => void; busy: string }) {
  const res = d.screenRes ? `${d.screenRes.w}×${d.screenRes.h}` : '–';
  const showing = d.targetKind === 'carousel' ? carouselShowing(saved, d) : '';
  const vp = d.viewport ? `${d.viewport.w}×${d.viewport.h}` : null;
  return (
    <section class={`disp ${d.connected ? 'is-on' : 'is-off'}`}>
      <header class="disp__head">
        <span class={`disp__state ${d.connected ? 'is-on' : ''}`}>
          <Icon name={d.connected ? 'wifi' : 'wifiOff'} size={16} />
        </span>
        <div class="disp__titles">
          <strong>
            {d.targetKind === 'carousel' && <Icon name="repeat" size={14} />} {d.screenName || d.screenSlug || '–'}
          </strong>
          {d.targetKind === 'carousel' && <span class="muted small">{t('Carrusel')}{showing ? ` · ${t('ahora: {name}', { name: showing })}` : ''}</span>}
          <span class="muted small">
            <span class="mono">{d.clientId.length > 14 ? `…${d.clientId.slice(-8)}` : d.clientId}</span> · {d.ip || '–'}
          </span>
        </div>
        <AccessBadge d={d} />
        <span class={`badge ${d.connected ? 'badge--ok' : 'badge--soft'}`}>{d.connected ? t('En línea') : t('Desconectada')}</span>
      </header>
      <dl class="disp__facts">
        <div>
          <dt>{t('Navegador')}</dt>
          <dd title={d.userAgent}>{d.uaShort || '–'}</dd>
        </div>
        <div>
          <dt>{t('Resolución')}</dt>
          <dd>
            {res}
            {d.dpr != null && <span class="muted"> @{Math.round(d.dpr * 100) / 100}x</span>}
            {vp && vp !== res && <span class="muted small"> · {t('ventana')} {vp}</span>}
          </dd>
        </div>
        <div>
          <dt>WebGL</dt>
          <dd>{d.webgl == null ? '–' : d.webgl ? <span class="ok-text">{t('Activo')}</span> : <span class="muted">{d.lite ? t('Modo ligero') : t('Desactivado')}</span>}</dd>
        </div>
        <div>
          <dt>{t('Versión')}</dt>
          <dd>
            {d.version ?? '–'}
            {d.outdated && (
              <span class="badge badge--warn" title={t('El servidor ejecuta la versión {v}', { v: serverVersion })}>
                {t('antigua')}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>{d.connected ? t('Conectada desde') : t('Última vez')}</dt>
          <dd title={d.connected ? d.connectedAt ?? '' : d.lastSeen}>{d.connected ? fmtDateTime(d.connectedAt) : relTime(d.lastSeen)}</dd>
        </div>
        <div>
          <dt>{t('Último latido')}</dt>
          <dd title={d.lastSeen}>
            {relTime(d.lastSeen)}
            {d.uptimeSec != null && d.connected && <span class="muted small"> · {t('arriba {d}', { d: formatDuration(d.uptimeSec) })}</span>}
          </dd>
        </div>
        <div>
          <dt>{t('Modo noche')}</dt>
          <dd>
            {d.night == null ? '–' : d.night ? `🌙 ${t('Atenuada')}` : `☀️ ${t('Normal')}`}
            {d.nightOverride && d.nightOverride !== 'auto' && <span class="muted small"> · {t('manual')}</span>}
          </dd>
        </div>
        <div>
          <dt>{t('Visto por primera vez')}</dt>
          <dd>{fmtDateTime(d.firstSeen)}</dd>
        </div>
      </dl>
      {d.lastError && (
        <div class="test-result is-err disp__err" title={d.lastError}>
          <Icon name="alert" size={14} /> {d.lastError}
        </div>
      )}
      <footer class="disp__actions">
        {d.connected && has('displayCommands') ? (
          <>
            <Button size="sm" icon="refresh" loading={busy === 'reload'} onClick={() => onCmd('reload')}>
              {t('Recargar')}
            </Button>
            <Button size="sm" icon="target" loading={busy === 'identify'} onClick={() => onCmd('identify')}>
              {t('Identificar')}
            </Button>
            <span class="spacer" />
            <NightMenu value={d.nightOverride} busy={busy.startsWith('night')} onPick={(m) => onCmd('night', m)} />
          </>
        ) : d.connected ? null : (
          <>
            <span class="muted small">{t('Sin conexión: las órdenes no llegarán.')}</span>
            <span class="spacer" />
            <Button size="sm" variant="ghost" icon="trash" onClick={onForget}>
              {t('Olvidar')}
            </Button>
          </>
        )}
      </footer>
    </section>
  );
}

/** How the display got in: private link, paired device (its name), admin session or no key (open mode). */
function AccessBadge({ d }: { d: DisplayInfo }) {
  const a = d.access ?? 'open';
  if (a === 'key') return <span class="badge badge--access" title={t('Entra con el enlace privado de la pantalla')}>🔗 {t('Enlace privado')}</span>;
  if (a === 'device') return <span class="badge badge--access" title={t('Dispositivo vinculado')}>🔑 {d.deviceName || t('Vinculada')}</span>;
  if (a === 'session') return <span class="badge badge--access">{t('Sesión del panel')}</span>;
  return <span class="badge badge--access badge--warn-soft" title={t('Entra sin clave (modo abierto)')}>{t('Sin clave')}</span>;
}

/** "/?screen=x" → "https://host/?screen=x" (absolute URLs unchanged). */
const absUrl = (u: string | null) => (u ? new URL(u, location.origin).href : '');

export function DisplaysSection({ saved, go }: SectionProps) {
  const [data, setData] = useState<DisplaysResponse | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [showOffline, setShowOffline] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const links = useDisplayLinks(saved);

  const load = async () => {
    try {
      setData(await api.displays());
      setErr('');
    } catch (e) {
      setErr((e as ApiError).message);
    }
  };
  useEffect(() => {
    load();
    timer.current = window.setInterval(() => document.visibilityState === 'visible' && load(), 5000);
    return () => clearInterval(timer.current);
  }, []);

  const run = async (key: string, req: Parameters<typeof api.displayCommand>[0], label: string) => {
    setBusy((b) => ({ ...b, [key]: req.action === 'night' ? `night-${req.mode}` : req.action }));
    try {
      const r = await api.displayCommand(req);
      toast(r.delivered ? withPollNote(`${label} · ${nScreens(r.delivered)}`) : `${label} · ${nScreens(r.delivered)}`, r.delivered ? 'ok' : 'info');
      setTimeout(load, 1200);
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy((b) => ({ ...b, [key]: '' }));
    }
  };
  const label = (action: string, mode?: NightCommand) =>
    action === 'reload' ? t('Recargando') : action === 'identify' ? t('Identificando') : mode === 'on' ? t('Modo noche activado') : mode === 'off' ? t('Modo noche desactivado') : t('Modo noche automático');

  const forget = async (d: DisplayInfo) => {
    const ok = await confirmDialog({ title: t('¿Olvidar este dispositivo?'), body: t('Desaparecerá de la lista hasta que vuelva a conectarse.'), confirm: t('Olvidar') });
    if (!ok) return;
    try {
      await api.forgetDisplay(d.clientId);
      load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  const list = (data?.displays ?? []).filter((d) => (!filter || d.screenId === filter) && (showOffline || d.connected));
  const online = data?.displays.filter((d) => d.connected) ?? [];
  const outdated = online.filter((d) => d.outdated);
  // Filter pills list SAVED screens and carousels only: commands resolve their ids against the saved config.
  const carousels = saved.carousels?.items ?? [];
  const isScreen = !!filter && saved.screens.some((s) => s.id === filter);
  const target = filter && (isScreen || carousels.some((c) => c.id === filter)) ? { screens: [filter] } : {};
  const onlineHere = online.filter((d) => !filter || d.screenId === filter);
  const privacy = usePrivacy();
  // privacy mode belongs to screens: a carousel filter keeps the "every screen" menu
  const privTarget = isScreen ? { screens: [filter] } : {};
  const privRows = (privacy ?? []).filter((r) => !privTarget.screens || r.screenId === filter);
  const privRow = privRows.length ? { active: privRows.some((r) => r.active), until: privRows.find((r) => r.active)?.until ?? null } : undefined;

  return (
    <>
      <PageHeader title={t('Dispositivos conectados')} desc={t('Dispositivos que muestran el calendario ahora mismo. Se actualiza cada 5 s.')}>
        <Button variant="primary" icon="link" onClick={() => openPairDialog()}>
          {t('Vincular una pantalla')}
        </Button>
        {has('displayCommands') && (
          <>
            <Button icon="refresh" onClick={() => run('_all', { action: 'reload', ...target }, label('reload'))} loading={busy._all === 'reload'} disabled={!onlineHere.length}>
              {t('Recargar todas')}
            </Button>
            <Button icon="target" onClick={() => run('_all', { action: 'identify', ...target }, label('identify'))} loading={busy._all === 'identify'} disabled={!onlineHere.length}>
              {t('Identificar todas')}
            </Button>
          </>
        )}
      </PageHeader>

      {saved.security?.displayAccess === 'open' && <OpenModeCallout go={go} />}

      {outdated.length > 0 && (
        <Callout kind="warn">
          {t('{n} pantallas ejecutan una versión antigua (servidor {v}). Recárgalas para actualizar.', { n: outdated.length, v: data?.serverVersion ?? '' })}{' '}
          {has('displayCommands') && (
            <button type="button" class="link-btn" onClick={() => run('_all', { action: 'reload', clientIds: outdated.map((d) => d.clientId) }, label('reload'))}>
              {t('Recargar ahora')}
            </button>
          )}
        </Callout>
      )}

      <div class="toolbar">
        <div class="target-pick">
          <button type="button" class={`pill ${!filter ? 'is-on' : ''}`} onClick={() => setFilter('')}>
            {t('Todas')} <span class="pill__n">{data?.displays.length ?? 0}</span>
          </button>
          {saved.screens.map((s) => {
            const n = data?.displays.filter((d) => d.screenId === s.id).length ?? 0;
            return (
              <button type="button" class={`pill ${filter === s.id ? 'is-on' : ''}`} onClick={() => setFilter(s.id)}>
                <span class="dot-color" style={{ background: s.screen.accent }} /> {s.name} <span class="pill__n">{n}</span>
              </button>
            );
          })}
          {carousels.map((c) => {
            const n = data?.displays.filter((d) => d.screenId === c.id).length ?? 0;
            return (
              <button type="button" class={`pill ${filter === c.id ? 'is-on' : ''}`} title={t('Carrusel')} onClick={() => setFilter(c.id)}>
                <Icon name="repeat" size={13} /> {c.name} <span class="pill__n">{n}</span>
              </button>
            );
          })}
        </div>
        <label class="mini-toggle">
          <input type="checkbox" checked={showOffline} onChange={(e) => setShowOffline(e.currentTarget.checked)} />
          <span>{t('Mostrar desconectadas')}</span>
        </label>
        <div class="toolbar__night">
          <span class="muted small">{filter ? t('Noche en esta pantalla') : t('Noche en todas')}</span>
          <NightMenu value={null} busy={busy._all?.startsWith('night')} onPick={(m) => run('_all', { action: 'night', mode: m, ...target }, label('night', m))} />
        </div>
        {has('privacy') && (
          <div class="toolbar__night">
            <span class="muted small">{privTarget.screens ? t('Privado en esta pantalla') : t('Privado en todas')}</span>
            <PrivacyMenu screenId={privTarget.screens ? filter : ''} row={privRow} tz={saved.datetime.timezone} />
          </div>
        )}
      </div>

      {err && !data ? (
        <Card>
          <Empty icon="alert" title={t('No se pudo obtener la lista')}>
            {err}
          </Empty>
        </Card>
      ) : !data ? (
        <div class="disp-grid">
          <div class="skeleton skeleton--card" />
          <div class="skeleton skeleton--card" />
        </div>
      ) : list.length === 0 ? (
        <Card>
          <Empty icon="monitor" title={t('Ninguna pantalla conectada')}>
            {saved.security?.displayAccess === 'open' ? (
              <>
                {t('Abre')} <code>{absUrl(screenHref(saved, filter || saved.defaultScreen, links))}</code> {t('en el dispositivo y aparecerá aquí.')}
              </>
            ) : (
              t('Abre en el dispositivo el enlace privado de la pantalla (Pantalla → Ajustes) o vincúlalo con un código y aparecerá aquí.')
            )}
          </Empty>
        </Card>
      ) : (
        <div class="disp-grid">
          {list.map((d) => (
            <DisplayCard
              key={d.clientId}
              d={d}
              saved={saved}
              serverVersion={data.serverVersion}
              busy={busy[d.clientId] ?? ''}
              onForget={() => forget(d)}
              onCmd={(action, mode) => run(d.clientId, { action, mode, clientIds: [d.clientId] }, label(action, mode))}
            />
          ))}
        </div>
      )}
      <PairedDevicesCard saved={saved} onChanged={load} />
      <p class="muted small center">
        <StatusDot state={online.length ? 'ok' : 'idle'} /> {t('{n} en línea', { n: online.length })} · {t('servidor v{v}', { v: data?.serverVersion ?? '–' })}
      </p>
    </>
  );
}
