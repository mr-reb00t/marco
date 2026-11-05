import { useEffect, useState } from 'preact/hooks';
import type { AdminStatus, SourceRefreshResponse } from '../../shared/types';
import { BIRTHDAYS_SOURCE_ID, LOCAL_SOURCE_ID } from '../../shared/types';
import { api, ApiError } from '../api';
import { Icon } from '../components/icons';
import { Button, Card, Empty, PageHeader, StatusDot } from '../components/ui';
import { has, runtime } from '../caps';
import { formatDuration, relTime, t } from '../i18n';
import type { SectionProps } from './common';
import { fetchErrorText } from '../apiErrors';
import { sourceRowName } from '../util';
import { UpdatesCard } from '../components/Updates';
import { toast } from '../components/feedback';

/** Epoch ms of an ISO time, or 0 when absent or unreadable. */
const msOf = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

/** Cooldowns (epoch ms when allowed again; '*' = Descargar todos) carried by a status or refresh answer. */
function coolOf(st: Pick<AdminStatus, 'sources' | 'refreshAllAfter'>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of st.sources) if (msOf(s.refreshAfter) > 0) out[s.id] = msOf(s.refreshAfter);
  if (msOf(st.refreshAllAfter) > 0) out['*'] = msOf(st.refreshAllAfter);
  return out;
}

export function StatusSection({ cfg }: SectionProps) {
  const newsOn = has('news');
  const showUptime = runtime() !== 'workers';
  const [st, setSt] = useState<AdminStatus | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [, tick] = useState(0);
  // Manual downloads (#37): busy is '' (idle), '*' (all) or a source id; cool keeps when each may run again.
  const canRefresh = has('sourceRefresh');
  const [busy, setBusy] = useState('');
  const [cool, setCool] = useState<Record<string, number>>({});

  const load = async () => {
    setLoading(true);
    try {
      const next = await api.status();
      setSt(next);
      setCool(coolOf(next));
      setErr('');
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    const a = setInterval(load, 15000);
    const b = setInterval(() => tick((n) => n + 1), 5000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const now = Date.now();
  const leftOf = (key: string) => Math.max(0, Math.ceil(((cool[key] || 0) - now) / 1000));
  const cooling = Object.values(cool).some((at) => at > now);
  // A 1 s tick only while a wait is counting down, so the "Espera" texts stay exact.
  useEffect(() => {
    if (!cooling) return;
    const c = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(c);
  }, [cooling]);

  const srcMeta = (id: string) => cfg.calendar.sources.find((s) => s.id === id);
  const refreshable = (id: string) => {
    const m = srcMeta(id);
    return Boolean(m) && m!.enabled !== false && id !== LOCAL_SOURCE_ID && id !== BIRTHDAYS_SOURCE_ID;
  };
  const hasRemoteEnabled = cfg.calendar.sources.some((s) => s.enabled !== false);
  const allLeft = leftOf('*');

  const download = async (sourceId?: string) => {
    setBusy(sourceId || '*');
    try {
      const r: SourceRefreshResponse = await api.refreshSources(sourceId);
      setSt((p) => p && { ...p, sources: r.sources, refreshAllAfter: r.refreshAllAfter });
      setCool(coolOf(r));
      const failed = r.results.some((x) => x.result === 'error');
      if (sourceId) {
        if (failed) toast(t('No se pudo descargar el calendario.'), 'error');
        else toast(t('Calendario descargado'));
      } else if (failed) toast(t('Algunos calendarios no se pudieron descargar.'), 'error');
      else if (r.results.some((x) => x.result === 'ok')) toast(t('Calendarios descargados'));
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 429) {
        const raw = Number((err.body as { retryAfter?: unknown } | undefined)?.retryAfter);
        const secs = Number.isInteger(raw) && raw >= 1 && raw <= 3600 ? raw : 60;
        setCool((c) => ({ ...c, [sourceId || '*']: Date.now() + secs * 1000 }));
        toast(t('Ya se descargó hace un momento. Inténtalo de nuevo en {secs} s.', { secs }), 'info');
      } else toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };
  const okCount = st?.sources.filter((s) => s.ok).length ?? 0;

  return (
    <>
      <PageHeader title={t('Estado')} desc={t('Salud de las fuentes y pantallas conectadas. Se actualiza cada 15 s.')}>
        {canRefresh && (
          <Button
            icon="download"
            loading={busy === '*'}
            disabled={!!busy || allLeft > 0 || !hasRemoteEnabled}
            title={allLeft > 0 ? t('Espera {secs} s', { secs: allLeft }) : t('Descarga ahora todos los calendarios activos')}
            onClick={() => download()}
          >
            {t('Descargar todos')}
          </Button>
        )}
        <Button icon="refresh" loading={loading} onClick={load}>
          {t('Actualizar')}
        </Button>
      </PageHeader>
      {err && !st ? (
        <Card>
          <Empty icon="alert" title={t('No se pudo obtener el estado')}>
            {err}
          </Empty>
        </Card>
      ) : (
        <>
          <div class="stats">
            <div class="stat">
              <span class="stat__icon">
                <Icon name="monitor" size={18} />
              </span>
              <div>
                <div class="stat__value">{st ? st.displays : '–'}</div>
                <div class="stat__label">{t('Pantallas conectadas')}</div>
              </div>
            </div>
            <div class="stat">
              <span class="stat__icon">
                <Icon name="calendar" size={18} />
              </span>
              <div>
                <div class="stat__value">
                  {st ? `${okCount}/${st.sources.length}` : '–'}
                </div>
                <div class="stat__label">{t('Calendarios OK')}</div>
              </div>
            </div>
            <div class="stat">
              <span class="stat__icon">
                <Icon name="cloud" size={18} />
              </span>
              <div>
                <div class="stat__value stat__value--text">
                  {st ? <StatusDot state={st.weather.ok ? 'ok' : 'error'} /> : null} {st ? relTime(st.weather.updatedAt) : '–'}
                </div>
                <div class="stat__label">{t('Tiempo')}</div>
              </div>
            </div>
            {newsOn && (
              <div class="stat">
                <span class="stat__icon">
                  <Icon name="news" size={18} />
                </span>
                <div>
                  <div class="stat__value stat__value--text">
                    {st ? <StatusDot state={st.news.ok ? 'ok' : 'error'} /> : null} {st ? relTime(st.news.updatedAt) : '–'}
                  </div>
                  <div class="stat__label">
                    {t('Noticias')}
                    {st?.news.count != null && ` · ${st.news.count}`}
                  </div>
                </div>
              </div>
            )}
            {showUptime && (
              <div class="stat">
                <span class="stat__icon">
                  <Icon name="activity" size={18} />
                </span>
                <div>
                  <div class="stat__value">{st && st.uptime != null ? formatDuration(st.uptime) : '–'}</div>
                  <div class="stat__label">{t('Servidor activo')}</div>
                </div>
              </div>
            )}
          </div>
          {newsOn && st?.news.error && (
            <div class="test-result is-err">
              <Icon name="alert" size={14} /> {t('Noticias')}: {fetchErrorText(st.news.error)}
            </div>
          )}
          <Card title={t('Fuentes de calendario')} icon="calendar">
            {!st ? (
              <div class="skeleton-list">
                <div class="skeleton" />
                <div class="skeleton" />
              </div>
            ) : st.sources.length === 0 ? (
              <Empty icon="calendar" title={t('No hay calendarios configurados')} />
            ) : (
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>{t('Calendario')}</th>
                      <th>{t('Estado')}</th>
                      <th class="num">{t('Eventos')}</th>
                      <th>{t('Última descarga')}</th>
                      {canRefresh && <th class="num" aria-label={t('Descargar ahora')} />}
                    </tr>
                  </thead>
                  <tbody>
                    {st.sources.map((s) => {
                      const m = srcMeta(s.id);
                      return (
                        <tr>
                          <td>
                            <span class="dot-color" style={{ background: m?.color ?? '#888' }} /> {m?.emoji} <strong>{sourceRowName(cfg, s.id, s.name)}</strong>
                          </td>
                          <td>
                            {s.ok ? (
                              <span class="ok-text">
                                <StatusDot state="ok" /> OK
                              </span>
                            ) : (
                              <span class="err-text" title={s.error ?? ''}>
                                <StatusDot state={s.lastFetch ? 'error' : 'idle'} /> {fetchErrorText(s.error) || t('Pendiente')}
                              </span>
                            )}
                          </td>
                          <td class="num">{s.count}</td>
                          <td class="muted" title={s.lastFetch ?? ''}>
                            {relTime(s.lastFetch)}
                          </td>
                          {canRefresh && (
                            <td class="num">
                              {refreshable(s.id) && (
                                <>
                                  {leftOf(s.id) > 0 && <span class="muted">{t('Espera {secs} s', { secs: leftOf(s.id) })} </span>}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    icon="refresh"
                                    iconOnly
                                    aria-label={t('Descargar ahora')}
                                    title={t('Descargar ahora')}
                                    loading={busy === s.id}
                                    disabled={!!busy || leftOf(s.id) > 0}
                                    onClick={() => download(s.id)}
                                  />
                                </>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      <UpdatesCard />
    </>
  );
}
