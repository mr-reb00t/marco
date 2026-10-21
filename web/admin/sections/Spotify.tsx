// "Sonando ahora" with Spotify (issue #18): the household's own Spotify app (Client ID and Client Secret from Spotify's
// developer dashboard, so every household uses its own API quota), the exact Redirect URI to register there, and the
// linked accounts. The secret is write-only: the server only says whether one is stored. Screens show an account by an
// opaque id (the Sonando ahora card, and "Sonando ahora bajo el reloj" in Diseño); its tokens never leave the server.
import { useEffect, useState } from 'preact/hooks';
import type { SpotifyAccount, SpotifyStatus, StoredConfig } from '../../shared/types';
import { nowPlayingAccounts, SPOTIFY_APPS_URL, SPOTIFY_CLIENT_ID_RE, SPOTIFY_DASHBOARD_URL, SPOTIFY_SECRET_RE } from '../../../server/core/nowPlayingCore.js';
import { api, ApiError } from '../api';
import { isSelfHosted } from '../caps';
import { confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { CopyField } from '../components/share';
import { Button, Callout, Card, Empty, Field, PageHeader, Select, TextInput } from '../components/ui';
import { t } from '../i18n';
import type { SectionProps } from './common';

const errorCode = (e: unknown): string => {
  const b = (e as ApiError)?.body as { error?: unknown } | undefined;
  return typeof b?.error === 'string' ? b.error : '';
};

/** Text for a code of a failed connect (/admin/?error=spotify_..., POST /api/admin/spotify/finish). */
export function spotifyErrorText(code: string): string {
  const map: Record<string, string> = {
    spotify_not_configured: 'Guarda primero el Client ID y el Client Secret de tu app de Spotify.',
    spotify_invalid_state: 'La conexión con Spotify caducó o se abrió en otro navegador. Inténtalo de nuevo.',
    spotify_missing_code: 'Spotify no devolvió autorización. Inténtalo de nuevo.',
    spotify_no_refresh_token: 'Spotify no concedió acceso permanente. Inténtalo de nuevo.',
    spotify_scope_denied: 'No se concedió permiso para ver lo que suena.',
    spotify_too_many_accounts: 'Has llegado al máximo de cuentas de Spotify conectadas.',
    spotify_exchange_failed: 'Error al comunicar con Spotify. Revisa que la Redirect URI de tu app sea exactamente la de esta página.',
    spotify_app_refused: 'Spotify no acepta el Client ID o el Client Secret. Revísalos en el panel de desarrolladores.',
    spotify_unavailable: 'Spotify no responde ahora mismo. Inténtalo de nuevo en unos minutos.',
    spotify_access_denied: 'Has cancelado el acceso con Spotify.',
    spotify_bad_address: 'Esa no es la dirección a la que te llevó Spotify. Copia la dirección completa de la página que no cargó.',
  };
  return map[code] ? t(map[code]) : `${t('Error de Spotify')}: ${code.replace(/^spotify_/, '')}`;
}

// ---- the accounts, shared by the pickers (Diseño, the builder) ------------------------------------------------------
let cache: Promise<SpotifyAccount[]> | null = null;
const listeners = new Set<(a: SpotifyAccount[]) => void>();
function loadAccounts(force = false): Promise<SpotifyAccount[]> {
  if (!cache || force) {
    cache = api.spotify().then((s) => s.accounts, () => []);
    void cache.then((a) => listeners.forEach((l) => l(a)));
  }
  return cache;
}

/** The linked Spotify accounts (null while loading), shared by every picker; asks the server once. */
export function useSpotifyAccounts(on = true): SpotifyAccount[] | null {
  const [list, setList] = useState<SpotifyAccount[] | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const l = (a: SpotifyAccount[]) => live && setList(a);
    listeners.add(l);
    void loadAccounts().then(l);
    return () => {
      live = false;
      listeners.delete(l);
    };
  }, [on]);
  return list;
}

/** Which account a card or a screen shows: '' (none) or one of the linked ones. */
export function SpotifyAccountSelect(props: { value: string; onChange: (v: string) => void; none: string; go?: (route: string) => void }) {
  const list = useSpotifyAccounts();
  if (list && !list.length) {
    return (
      <Callout>
        {t('Todavía no hay cuentas de Spotify conectadas.')}{' '}
        {props.go && (
          <button type="button" class="link-btn" onClick={() => props.go!('spotify')}>
            {t('Ir a la página Spotify')}
          </button>
        )}
      </Callout>
    );
  }
  const known = (list ?? []).some((a) => a.id === props.value);
  return (
    <Select
      value={props.value}
      options={[
        { value: '', label: t(props.none) },
        ...(list ?? []).map((a) => ({ value: a.id, label: a.status === 'reconnect' ? `${a.name} (${t('hay que volver a conectarla')})` : a.name })),
        ...(props.value && list && !known ? [{ value: props.value, label: t('Una cuenta que ya no está conectada') }] : []),
      ]}
      onChange={props.onChange}
    />
  );
}

/** Screen names that show an account (the cards of Personalizado screens, or the line under the clock). */
function usedOn(full: StoredConfig, id: string): string[] {
  return full.screens.filter((s) => (nowPlayingAccounts(s) as string[]).includes(id)).map((s) => s.name);
}

export function SpotifySection({ full, dirty, save }: SectionProps) {
  const [st, setSt] = useState<SpotifyStatus | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [editSecret, setEditSecret] = useState(false);
  const [busy, setBusy] = useState('');
  const [pasted, setPasted] = useState('');

  const apply = (s: SpotifyStatus) => {
    setSt(s);
    setClientId(s.clientId);
    void loadAccounts(true);
  };
  useEffect(() => {
    api.spotify().then(apply, () => setLoadErr(true));
  }, []);

  const idOk = SPOTIFY_CLIENT_ID_RE.test(clientId.trim());
  const secretOk = !secret.trim() || SPOTIFY_SECRET_RE.test(secret.trim());
  const changedApp = st && clientId.trim() !== st.clientId;
  const needSecret = !st?.secretSet || changedApp;

  const saveApp = async () => {
    if (!st) return;
    if (changedApp && st.accounts.length) {
      const ok = await confirmDialog({
        title: t('¿Cambiar de app de Spotify?'),
        body: t('Las cuentas conectadas pertenecen a la app anterior y se quitarán. Tendrás que conectarlas otra vez.'),
        confirm: t('Cambiar'),
        danger: true,
      });
      if (!ok) return;
    }
    setBusy('app');
    try {
      apply(await api.setSpotifyApp({ clientId: clientId.trim(), ...(secret.trim() ? { clientSecret: secret.trim() } : {}) }));
      setSecret('');
      setEditSecret(false);
      toast(t('App de Spotify guardada'), 'ok');
    } catch (e) {
      const c = errorCode(e);
      toast(c === 'client_id_invalid' ? t('El Client ID no es válido.') : c === 'client_secret_invalid' ? t('El Client Secret no es válido.') : c === 'client_secret_required' ? t('Falta el Client Secret.') : t('No se pudo guardar.'), 'error');
    } finally {
      setBusy('');
    }
  };

  const removeApp = async () => {
    const ok = await confirmDialog({ title: t('¿Quitar la app de Spotify?'), body: t('Se quitan también todas las cuentas conectadas. Las tarjetas que las muestran dejarán de verse.'), confirm: t('Quitar'), danger: true });
    if (!ok) return;
    setBusy('app');
    try {
      apply(await api.setSpotifyApp({ clientId: '' }));
      toast(t('App de Spotify quitada'));
    } catch {
      toast(t('No se pudo guardar.'), 'error');
    } finally {
      setBusy('');
    }
  };

  const connect = async () => {
    if (!st) return;
    // the page leaves for Spotify: keep what was being edited first
    if (dirty && !(await save())) return;
    if (st.paste) {
      // the admin stays here, waiting for the address the browser lands on
      window.open('/auth/spotify/connect', '_blank', 'noopener');
      return;
    }
    location.assign('/auth/spotify/connect');
  };

  const finish = async () => {
    setBusy('finish');
    try {
      const out = await api.finishSpotify(pasted.trim());
      apply(out);
      setPasted('');
      const name = out.accounts.find((a) => a.id === out.id)?.name;
      toast(name ? t('Cuenta de Spotify conectada: {name}', { name }) : t('Cuenta de Spotify conectada'), 'ok');
    } catch (e) {
      toast(spotifyErrorText(errorCode(e) || 'spotify_exchange_failed'), 'error');
    } finally {
      setBusy('');
    }
  };

  const test = async (a: SpotifyAccount) => {
    setBusy(`test:${a.id}`);
    try {
      const r = await api.spotifyNow(a.id);
      if (r.item) toast(t('Suena: {what}', { what: r.item.artist ? `${r.item.title} · ${r.item.artist}` : r.item.title }), 'ok');
      else if (r.error === 'auth') toast(t('Spotify no acepta esta cuenta. Vuelve a conectarla.'), 'error');
      else if (r.error === 'app') toast(t('Spotify no acepta el Client Secret de tu app. Revísalo y guárdalo otra vez.'), 'error');
      else if (r.error) toast(t('Spotify no responde ahora mismo. Inténtalo de nuevo en unos minutos.'), 'error');
      else toast(t('Conectada. Ahora mismo no suena nada.'));
      if (r.error === 'auth' || r.error === 'app') api.spotify().then(apply, () => {});
    } catch {
      toast(t('No se pudo comprobar.'), 'error');
    } finally {
      setBusy('');
    }
  };

  const remove = async (a: SpotifyAccount) => {
    const on = usedOn(full, a.id);
    const ok = await confirmDialog({
      title: t('¿Desconectar {name}?', { name: a.name }),
      body: on.length ? t('Estas pantallas la muestran y dejarán de mostrarla: {list}.', { list: on.join(', ') }) : t('Marco borra sus claves de acceso.'),
      confirm: t('Desconectar'),
      danger: true,
    });
    if (!ok) return;
    setBusy(`rm:${a.id}`);
    try {
      await api.removeSpotifyAccount(a.id);
      apply(await api.spotify());
      toast(t('Cuenta desconectada. Para quitarle el acceso también en Spotify, ve a spotify.com/account/apps.'));
    } catch {
      toast(t('No se pudo desconectar.'), 'error');
    } finally {
      setBusy('');
    }
  };

  if (loadErr) return <Callout kind="error">{t('No se pudo cargar.')}</Callout>;
  const ready = !!st?.clientId && !!st?.secretSet;
  const full_ = !!st && st.accounts.length >= st.max;
  const needsReconnect = !!st?.accounts.some((a) => a.status === 'reconnect');

  return (
    <>
      <PageHeader
        title="Spotify"
        desc={t('Muestra en las pantallas lo que suena en Spotify: la canción, el artista y la portada. Solo se lee lo que suena, nunca se controla. Cada casa usa su propia app de Spotify.')}
      />
      <Card id="spotify-app" scope="global" title={t('Tu app de Spotify')} icon="key" desc={t('Spotify pide que cada casa cree su propia app, gratis. Solo hace falta una vez.')}>
        <ol class="howto">
          <li>
            {t('Abre el panel de desarrolladores de Spotify y crea una app (el nombre y la descripción que quieras). Spotify pide que la cuenta que crea la app tenga Premium para usar la Web API.')}{' '}
            <a class="ext-link" href={SPOTIFY_DASHBOARD_URL} target="_blank" rel="noopener noreferrer">
              developer.spotify.com/dashboard <Icon name="external" size={13} />
            </a>
          </li>
          <li>
            {t('En «Redirect URIs» añade exactamente esta dirección:')}
            {st && <CopyField value={st.redirectUri} label={t('Copiar la Redirect URI')} />}
          </li>
          <li>{t('En las APIs que vas a usar marca «Web API» y guarda.')}</li>
          <li>{t('Copia aquí el Client ID y el Client Secret (en Settings de la app).')}</li>
          <li>{t('Mientras la app está en modo de desarrollo, añade en «User Management» a cada persona que vaya a conectar su cuenta.')}</li>
        </ol>
        {st?.paste && (
          <Callout kind="warn">
            {t('Spotify solo devuelve a direcciones https, o a http://127.0.0.1 en el propio equipo («localhost» no vale). Este servidor no tiene una dirección https, así que usa la de arriba: después de permitir el acceso el navegador mostrará una página que no carga, o un aviso de Marco. Copia la dirección de esa página y pégala aquí abajo.')}
            {isSelfHosted() && <> {t('Con una dirección https propia (PUBLIC_URL en el archivo .env, por ejemplo detrás de un proxy como Caddy), Spotify vuelve aquí solo.')}</>}
          </Callout>
        )}
        {st?.paste && st.tunnel && <TunnelGuide tunnel={st.tunnel} />}
        {st?.appRefused && (
          <Callout kind="error">
            {t('Spotify no acepta el Client Secret de tu app. Si lo cambiaste en el panel de desarrolladores, pega aquí el nuevo y guárdalo: las cuentas conectadas siguen valiendo y no hay que volver a conectarlas.')}
          </Callout>
        )}
        <div class="grid grid--2">
          <Field label="Client ID" error={clientId.trim() && !idOk ? t('El Client ID no es válido.') : undefined}>
            <TextInput mono autocomplete="off" value={clientId} error={!!clientId.trim() && !idOk} placeholder="0123456789abcdef0123456789abcdef" onValue={setClientId} />
          </Field>
          <Field label="Client Secret" hint={t('Se guarda solo en el servidor y nunca se vuelve a mostrar.')} error={!secretOk ? t('El Client Secret no es válido.') : undefined}>
            {st?.secretSet && !editSecret && !changedApp ? (
              <div class="search-row">
                <span class="wx-key-saved">
                  <Icon name="check" size={14} /> {t('Guardado')}
                </span>
                <Button onClick={() => setEditSecret(true)}>{t('Cambiar')}</Button>
              </div>
            ) : (
              <TextInput type="password" mono autocomplete="off" value={secret} error={!secretOk} placeholder={t('Pega aquí el Client Secret')} onValue={setSecret} prefix={<Icon name="key" size={14} />} />
            )}
          </Field>
        </div>
        <div class="row-actions">
          <Button variant="primary" loading={busy === 'app'} disabled={!st || !idOk || !secretOk || (needSecret && !secret.trim()) || (!changedApp && !secret.trim())} onClick={saveApp}>
            {t('Guardar la app')}
          </Button>
          {st?.clientId && (
            <Button variant="danger" disabled={!!busy} onClick={removeApp}>
              {t('Quitar la app')}
            </Button>
          )}
        </div>
      </Card>
      <Card
        id="spotify-accounts"
        scope="global"
        title={t('Cuentas conectadas')}
        icon="music"
        muted={!ready}
        desc={t('Cada persona conecta su cuenta. En Diseño (o en la tarjeta Sonando ahora de Personalizado) eliges qué cuenta muestra cada pantalla.')}
        actions={
          <Button size="sm" variant="primary" icon="plus" disabled={!ready || full_} onClick={connect}>
            {t('Conectar una cuenta de Spotify')}
          </Button>
        }
      >
        {!st ? (
          <p class="muted small">{t('Cargando…')}</p>
        ) : !ready ? (
          <Callout>{t('Guarda primero el Client ID y el Client Secret de tu app de Spotify.')}</Callout>
        ) : st.accounts.length === 0 ? (
          <Empty icon="music" title={t('Todavía no hay cuentas de Spotify conectadas.')} />
        ) : (
          <ul class="sp-accounts">
            {st.accounts.map((a) => {
              const on = usedOn(full, a.id);
              return (
                <li class="sp-account">
                  <span class="sp-account__icon">
                    <Icon name="music" size={18} />
                  </span>
                  <div class="sp-account__text">
                    <strong>{a.name}</strong>
                    <small class="muted">{on.length ? t('En: {list}', { list: on.join(', ') }) : t('Ninguna pantalla la muestra todavía')}</small>
                    {a.status === 'reconnect' && (
                      <span>
                        <span class="badge badge--soft">{t('hay que volver a conectarla')}</span>
                      </span>
                    )}
                  </div>
                  <div class="sp-account__actions">
                    {a.status === 'reconnect' ? (
                      // the same Spotify person keeps this id, so the screens that show it go on working
                      <Button size="sm" variant="primary" icon="link" disabled={!!busy} onClick={connect}>
                        {t('Volver a conectar')}
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" icon="play" loading={busy === `test:${a.id}`} onClick={() => test(a)}>
                        {t('Probar')}
                      </Button>
                    )}
                    <Button size="sm" variant="danger" loading={busy === `rm:${a.id}`} onClick={() => remove(a)}>
                      {t('Desconectar')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {full_ && <p class="muted small">{t('Como mucho {n} cuentas.', { n: st!.max })}</p>}
        {st?.paste && ready && (!full_ || needsReconnect) && (
          <form
            class="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (pasted.trim()) void finish();
            }}
          >
            <Field label={t('Dirección de la página que no cargó')} hint={t('Empieza por http://127.0.0.1 y lleva code= y state=.')}>
              <div class="search-row">
                <TextInput mono autocomplete="off" value={pasted} onValue={setPasted} placeholder={`${st.redirectUri}?code=…&state=…`} />
                <Button type="submit" variant="primary" loading={busy === 'finish'} disabled={!pasted.trim()}>
                  {t('Terminar la conexión')}
                </Button>
              </div>
            </Field>
          </form>
        )}
        {st && ready && (
          <p class="muted small">
            {t('Para quitarle a Marco el acceso también en Spotify:')}{' '}
            <a href={SPOTIFY_APPS_URL} target="_blank" rel="noopener noreferrer">
              spotify.com/account/apps
            </a>
          </p>
        )}
      </Card>
    </>
  );
}

/**
 * Paste mode on a server reached over plain http: how to connect without pasting anything, through an SSH tunnel from
 * the owner's computer. With the tunnel open the admin is on http://127.0.0.1:<port>, the address Spotify accepts, so
 * Spotify comes back to the admin on its own.
 */
function TunnelGuide({ tunnel }: { tunnel: { hosts: string[]; port: number } }) {
  const port = tunnel.port;
  const host = tunnel.hosts[0] || t('IP-del-servidor');
  const here = location.hostname === '127.0.0.1' && Number(location.port || 80) === port;
  const cmd = `ssh -L ${port}:127.0.0.1:${port} ${t('usuario')}@${host}`;
  const admin = `http://127.0.0.1:${port}/admin`;
  return (
    <details class="pair-alt tunnel-guide">
      <summary>
        <Icon name="info" size={16} />
        <span>{t('Conectar sin pegar nada: un túnel SSH desde tu ordenador')}</span>
        <Icon name="chevron" size={16} class="tunnel-guide__chev" />
      </summary>
      {here ? (
        <p class="muted small">{t('Ya estás entrando por 127.0.0.1: pulsa «Conectar» y Spotify volverá aquí solo.')}</p>
      ) : (
        <ol class="howto">
          <li>
            {t('En tu ordenador, abre una terminal (en Windows, PowerShell) y ejecuta esto. Cambia «usuario» por tu usuario en el servidor y deja la ventana abierta:')}
            <CopyField value={cmd} label={t('Copiar el comando')} />
            {tunnel.hosts.length > 1 && <span class="muted small">{t('Si no conecta, prueba con otra dirección del servidor: {list}.', { list: tunnel.hosts.slice(1).join(', ') })}</span>}
          </li>
          <li>
            {t('Abre el panel por el túnel e inicia sesión ahí:')}
            <CopyField value={admin} label={t('Copiar la dirección')} />
          </li>
          <li>{t('Vuelve a esta página y pulsa «Conectar». Spotify volverá al panel y la cuenta quedará conectada sin pegar nada.')}</li>
          <li>{t('Cuando termines, cierra la terminal. Marco sigue funcionando como siempre y la cuenta queda guardada.')}</li>
        </ol>
      )}
    </details>
  );
}
