// Display access UI: per-screen private link card, "Pair a screen" dialog (opened from anywhere through
// openPairDialog(), e.g. the QR on a waiting display → /admin/#pair=<code>), paired devices list and the
// open-mode recommendation. Server side: server/displayAccess.js, server/pairing.js; docs/API.md "Display access".
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { DisplayAccessMode, DisplayLinksResponse, PairConfirm, PairedDevice, StoredConfig } from '../../shared/types';
import { caps, has, pairCodeLength } from '../caps';
import { claimErrorCode, cleanCode, confirmWhere, formatCode } from '../pairCode';
import { displayOriginOf, refreshDisplayLinks, useDisplayLinks, usesPrivateLinks } from '../displayLinks';
import { api, ApiError } from '../api';
import { fmtDateTime } from '../dates';
import { relTime, t } from '../i18n';
import { confirmDialog, toast } from './feedback';
import { Icon } from './icons';
import { kioskInstallCommand } from '../../shared/project';
import { CopyField, Qr } from './share';
import { Button, Callout, Card, Empty, Field, Modal, Select, TextInput } from './ui';

export { CODE_ALPHABET, cleanCode, formatCode, claimErrorCode, confirmWhere } from '../pairCode';
/** Longest code any server uses (caps.ts accepts 4 to 12). */
const MAX_CODE_LENGTH = 12;

export const isLocalhost = () => /^(localhost|127\.|\[::1\])/.test(location.hostname);

/**
 * Origin other devices can reach this server at. Opened on the server itself (http://localhost) the admin uses
 * PUBLIC_URL or this machine's LAN address (same as the setup wizard); '' when neither is known (Docker without
 * LAN_ADDRESS): then the QR code and kiosk command are hidden instead of pointing devices at "localhost".
 */
export function shareOrigin(data: Pick<DisplayLinksResponse, 'lanAddresses' | 'publicUrl' | 'displayOrigin'> | null): string {
  // Marco Cloud serves the display pages from their own origin.
  const display = displayOriginOf(data as DisplayLinksResponse | null);
  if (display) return display;
  if (!isLocalhost()) return location.origin;
  if (data?.publicUrl) return data.publicUrl;
  const ip = data?.lanAddresses?.[0];
  return ip ? `${location.protocol}//${ip}${location.port ? `:${location.port}` : ''}` : '';
}

export const kioskCommand = kioskInstallCommand;

/* ------------------------------------------------------------------ private link card (per screen) */

export function PrivateLinkCard({ screenId, saved, mode, go }: { screenId: string; saved: StoredConfig; mode: DisplayAccessMode; go: (r: string) => void }) {
  const [data, setData] = useState<DisplayLinksResponse | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const isSaved = saved.screens.some((s) => s.id === screenId);
  const load = () =>
    api
      .displayLinks()
      .then((d) => {
        setData(d);
        setErr('');
      })
      .catch((e) => setErr((e as ApiError).message));
  useEffect(() => {
    load();
  }, [saved.revision]);
  const link = data?.links.find((l) => l.screenId === screenId);
  const origin = shareOrigin(data);
  // What other devices open / scan / put in KIOSK_URL ("Open" below stays on this browser's own origin, or the
  // display origin when the server has one).
  const url = link ? `${origin || location.origin}${link.path}` : '';

  const regenerate = async () => {
    if (!link) return;
    const ok = await confirmDialog({
      title: t('¿Regenerar el enlace privado?'),
      body: t('El enlace actual deja de funcionar al instante y las pantallas que lo usan mostrarán «enlace no válido». Después abre el enlace nuevo en ellas (o vincúlalas con un código). Un kiosco Raspberry Pi necesita el enlace nuevo en KIOSK_URL (~/.config/marco/kiosk.env) o volver a ejecutar el comando de abajo: allí la vinculación se pierde al reiniciarse.'),
      confirm: t('Regenerar enlace'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.regenerateLink(screenId);
      await Promise.all([load(), refreshDisplayLinks()]);
      toast(t('Enlace regenerado · el anterior ya no funciona'));
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      id="scr-link"
      scope="screen"
      title={t('Enlace privado')}
      icon="link"
      desc={t('Abre este enlace en la pantalla de este perfil (Raspberry Pi, tablet, tele). Quien tenga el enlace ve esta pantalla: compártelo solo con tus dispositivos.')}
    >
      {!isSaved ? (
        <Callout>{t('Guarda la pantalla para obtener su enlace privado.')}</Callout>
      ) : err && !data ? (
        <Callout kind="error">{err}</Callout>
      ) : !link ? (
        <div class="skeleton skeleton--card" />
      ) : (
        <>
          {mode === 'open' && (
            <Callout kind="warn">
              {t('Las pantallas están en modo abierto: este enlace funciona, pero también la dirección sin clave.')}{' '}
              <button type="button" class="link-btn" onClick={() => go('security/sec-display')}>
                {t('Cambiar a enlaces privados')}
              </button>
            </Callout>
          )}
          <div class="plink">
            {origin && (
              <div class="plink__qr">
                <Qr text={url} label={t('Código QR del enlace privado')} />
                <span class="muted small">{t('Escanéalo en la tablet o el móvil de la pantalla')}</span>
              </div>
            )}
            <div class="plink__main">
              <Field label={t('Enlace de la pantalla')}>
                <CopyField value={url} />
              </Field>
              {isLocalhost() && origin && <p class="muted small">{t('Estás en «localhost»: el enlace usa la dirección de red de este ordenador ({host}) para que funcione en otros dispositivos.', { host: new URL(origin).host })}</p>}
              {isLocalhost() && !origin && (
                <Callout kind="warn">{t('Estás en «localhost» y no se conoce la dirección de red de este servidor: abre el panel con su IP o su nombre (o define LAN_ADDRESS) para obtener el QR y el comando de la Raspberry Pi.')}</Callout>
              )}
              <div class="plink__actions">
                <a class="btn btn--default btn--sm" href={`${displayOriginOf(data) ?? ''}${link.path}`} target="_blank" rel="noopener noreferrer">
                  <Icon name="external" size={15} />
                  <span>{t('Abrir')}</span>
                </a>
                <Button size="sm" variant="ghost" icon="refresh" loading={busy} onClick={regenerate}>
                  {t('Regenerar enlace')}
                </Button>
                <span class="muted small">{t('Creado {when}', { when: relTime(link.createdAt) })}</span>
              </div>
              {origin && (
                <Field label={t('Raspberry Pi solo como pantalla (comando)')} hint={t('Ejecútalo en la Pi (Raspberry Pi OS con escritorio).')}>
                  <CopyField value={kioskCommand(url)} />
                </Field>
              )}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ open-mode recommendation */

export function OpenModeCallout({ go }: { go: (r: string) => void }) {
  return (
    <Callout kind="warn">
      {t('Las pantallas están en modo abierto: cualquiera que llegue a este servidor puede ver el calendario sin clave. Recomendado: enlaces privados y vinculación.')}{' '}
      <button type="button" class="link-btn" onClick={() => go('security/sec-display')}>
        {t('Ir a Seguridad')}
      </button>
    </Callout>
  );
}

/* ------------------------------------------------------------------ pair dialog (global host) */

let pairReq: { code: string } | null = null;
const pairListeners = new Set<() => void>();
/** Open the "Pair a screen" dialog (optionally prefilled, e.g. from /admin/#pair=<code>). */
export function openPairDialog(code = '') {
  pairReq = { code: cleanCode(code, MAX_CODE_LENGTH) };
  pairListeners.forEach((l) => l());
}

export function PairDialogHost({ saved, defaultScreenId, onPaired }: { saved: StoredConfig; defaultScreenId: string; onPaired?: (d: PairedDevice) => void }) {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    pairListeners.add(l);
    return () => void pairListeners.delete(l);
  }, []);
  if (!pairReq) return null;
  const close = () => {
    pairReq = null;
    force((n) => n + 1);
  };
  return <PairDialog key={pairReq.code} initialCode={pairReq.code} saved={saved} defaultScreenId={defaultScreenId} onClose={close} onPaired={onPaired} />;
}

/** "Or open the private link": the selected screen's private link with a QR code, folded under the pairing form. */
function PrivateLinkAlt({ saved, screenId }: { saved: StoredConfig; screenId: string }) {
  const links = useDisplayLinks(saved);
  const link = links.data?.links.find((l) => l.screenId === screenId);
  if (!usesPrivateLinks(saved) || !link) return null;
  const origin = shareOrigin(links.data);
  const url = `${origin || location.origin}${link.path}`;
  return (
    <details class="pair-alt">
      <summary>{t('O abre el enlace privado de la pantalla')}</summary>
      <p class="muted small">{t('Ábrelo en el navegador de la tele o la tablet, o escanea el QR. Quien tenga el enlace ve esta pantalla: compártelo solo con tus dispositivos.')}</p>
      <div class="pair-alt__body">
        {origin && <Qr text={url} label={t('Código QR del enlace privado')} />}
        <CopyField value={url} />
      </div>
    </details>
  );
}

/**
 * What a display can be bound to: the screens, then the carousels (servers with carousels). Grouped when there are
 * carousels, so the plain list looks as it always did.
 */
export function targetOptions(saved: StoredConfig): { value: string; label: string; group?: string }[] {
  const carousels = has('carousels') ? saved.carousels?.items ?? [] : [];
  if (!carousels.length) return saved.screens.map((s) => ({ value: s.id, label: s.name }));
  return [
    ...saved.screens.map((s) => ({ value: s.id, label: s.name, group: t('Pantallas') })),
    ...carousels.map((c) => ({ value: c.id, label: c.name, group: t('Carruseles') })),
  ];
}

function PairDialog({ initialCode, saved, defaultScreenId, onClose, onPaired }: { initialCode: string; saved: StoredConfig; defaultScreenId: string; onClose: () => void; onPaired?: (d: PairedDevice) => void }) {
  const screens = saved.screens;
  const len = pairCodeLength();
  // Marco Cloud serves the pairing page from its display origin: name the exact address to open on the TV.
  const displayOrigin = caps().displayOrigin;
  const pairAddress = displayOrigin ? `${displayOrigin.replace(/^https?:\/\//, '').replace(/\/$/, '')}/pair` : '';
  const [code, setCode] = useState(() => cleanCode(initialCode, len));
  const [screenId, setScreenId] = useState(screens.some((s) => s.id === defaultScreenId) ? defaultScreenId : screens[0]?.id ?? '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Second step: the server found the waiting display; the owner confirms it is the one in front of them.
  const [ask, setAsk] = useState<PairConfirm | null>(null);
  const [done, setDone] = useState<PairedDevice | null>(null);
  const complete = code.length === len;
  const options = targetOptions(saved);
  const screenName = options.find((o) => o.value === screenId)?.label ?? '';

  const paired = (device: PairedDevice) => {
    setDone(device);
    onPaired?.(device);
    toast(t('Pantalla vinculada: {name}', { name: device.name }));
  };

  const submit = async (e?: Event) => {
    e?.preventDefault();
    if (!complete || busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api.claimPairing({ code, screenId, name: name.trim() || undefined, ...(ask ? { confirm: true } : {}) });
      if (r.device) paired(r.device);
      else if (r.confirm) setAsk({ ...r.confirm, where: confirmWhere(r.confirm), screenName: r.confirm.screenName || screenName });
      else setErr(t('Respuesta inesperada del servidor. Inténtalo de nuevo.'));
    } catch (e2) {
      const ae = e2 as ApiError;
      const c = claimErrorCode(ae.body);
      setAsk(null);
      setErr(
        ae.status === 429 || c === 'rate_limited'
          ? t('Demasiados códigos incorrectos. Espera unos minutos.')
          : c === 'invalid_code'
            ? t('Código no encontrado o caducado. Comprueba el código que muestra la pantalla (debe seguir encendida en la página de vinculación).')
            : c === 'device_limit'
              ? t('Has llegado al máximo de dispositivos vinculados. Revoca uno que ya no uses.')
              : ae.message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('Vincular una pantalla')}
      icon="link"
      size="sm"
      onClose={onClose}
      dirty={!done && code !== initialCode && code.length > 0}
      footer={
        done ? (
          <Button variant="primary" icon="check" onClick={onClose}>
            {t('Hecho')}
          </Button>
        ) : ask ? (
          <>
            <Button variant="ghost" onClick={() => setAsk(null)} disabled={busy}>
              {t('Atrás')}
            </Button>
            <Button variant="primary" icon="link" loading={busy} onClick={() => submit()}>
              {t('Sí, vincular')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('Cancelar')}
            </Button>
            <Button variant="primary" loading={busy} disabled={!complete || !screenId} onClick={() => submit()}>
              {t('Continuar')}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div class="pair-done">
          <span class="pair-done__ico">
            <Icon name="check" size={26} />
          </span>
          <strong>{t('¡Listo! «{name}» muestra ahora {screen}.', { name: done.name, screen: done.screenName || ask?.screenName || screenName })}</strong>
          <p class="muted small">{t('La pantalla arranca sola en unos segundos. Puedes renombrarla o revocarla en Dispositivos conectados.')}</p>
        </div>
      ) : ask ? (
        <form class="stack pair-confirm" onSubmit={submit}>
          <div class="pair-confirm__code mono">{formatCode(code, len)}</div>
          <p>
            {ask.where
              ? t('Hay una pantalla en {where} esperando con este código. Mostrará «{screen}».', { where: ask.where, screen: ask.screenName })
              : t('Hay una pantalla esperando con este código. Mostrará «{screen}».', { screen: ask.screenName })}
          </p>
          <Callout kind="warn">{t('Vincula solo una pantalla que tengas delante. Si el código te llegó en un enlace o un mensaje de otra persona, cancela.')}</Callout>
          <button type="submit" hidden />
        </form>
      ) : (
        <form class="stack" onSubmit={submit}>
          <p class="muted small">
            {pairAddress
              ? t('En la tele, abre {url}: mostrará un código de {n} caracteres. Escríbelo aquí.', { url: pairAddress, n: len })
              : t('Abre Marco en la pantalla nueva (o la dirección /pair): mostrará un código de {n} caracteres. Escríbelo aquí.', { n: len })}
          </p>
          <Field label={t('Código de la pantalla')} error={err || undefined}>
            <input
              class={`input pair-code ${err ? 'is-invalid' : ''}`}
              value={formatCode(code, len)}
              inputMode="text"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellcheck={false}
              placeholder={formatCode('ABCDEFGH23456789'.slice(0, Math.ceil(len / 2)) + '23456789'.slice(0, len - Math.ceil(len / 2)), len)}
              aria-label={t('Código de la pantalla')}
              maxLength={len + 1}
              data-autofocus
              onInput={(e) => {
                setCode(cleanCode(e.currentTarget.value, len));
                setErr('');
              }}
            />
          </Field>
          <Field label={options.some((o) => o.group) ? t('Qué mostrará') : t('Qué pantalla mostrará')}>
            <Select value={screenId} options={options} onChange={(v) => setScreenId(v)} />
          </Field>
          <Field label={t('Nombre del dispositivo (opcional)')} hint={t('Por ejemplo «Tablet de la cocina». Por defecto: {name}.', { name: screenName })}>
            <TextInput value={name} maxLength={60} placeholder={screenName} onValue={setName} />
          </Field>
          <button type="submit" hidden />
          <PrivateLinkAlt saved={saved} screenId={screenId} />
        </form>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ paired devices */

export function PairedDevicesCard({ saved, onChanged }: { saved: StoredConfig; onChanged?: () => void }) {
  const [devices, setDevices] = useState<PairedDevice[] | null>(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<PairedDevice | null>(null);
  const load = () =>
    api
      .devices()
      .then((r) => {
        setDevices(r.devices);
        setErr('');
      })
      .catch((e) => setErr((e as ApiError).message));
  useEffect(() => {
    load();
    const id = window.setInterval(() => document.visibilityState === 'visible' && load(), 10000);
    const onPaired = () => load();
    window.addEventListener('marco:paired', onPaired);
    return () => {
      clearInterval(id);
      window.removeEventListener('marco:paired', onPaired);
    };
  }, []);

  const revoke = async (d: PairedDevice) => {
    const ok = await confirmDialog({
      title: t('¿Revocar «{name}»?', { name: d.name }),
      body: t('El dispositivo deja de ver el calendario al instante y muestra «enlace no válido». Para volver a usarlo tendrás que vincularlo de nuevo.'),
      confirm: t('Revocar'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.revokeDevice(d.id);
      toast(t('Dispositivo revocado'));
      load();
      onChanged?.();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  return (
    <Card
      id="disp-paired"
      title={t('Dispositivos vinculados')}
      icon="key"
      desc={t('Pantallas que entraron con un código de vinculación. Cada una tiene su propia llave: revócala si pierdes o regalas el dispositivo.')}
      actions={
        <Button size="sm" icon="plus" onClick={() => openPairDialog()}>
          {t('Vincular una pantalla')}
        </Button>
      }
    >
      {err && !devices ? (
        <Callout kind="error">{err}</Callout>
      ) : !devices ? (
        <div class="skeleton skeleton--card" />
      ) : devices.length === 0 ? (
        <Empty icon="link" title={t('Ningún dispositivo vinculado')}>
          {t('Abre Marco en una tablet o tele sin enlace privado: mostrará un código. Pulsa «Vincular una pantalla» y escríbelo.')}
        </Empty>
      ) : (
        <ul class="dev-list">
          {devices.map((d) => (
            <li class="dev">
              <span class={`dev__state ${d.connected ? 'is-on' : ''}`} title={d.connected ? t('En línea') : t('Desconectada')}>
                <Icon name={d.connected ? 'wifi' : 'wifiOff'} size={15} />
              </span>
              <div class="dev__main">
                <strong>{d.name}</strong>
                <span class="muted small">
                  <Icon name="monitor" size={12} /> {d.screenName || '–'} · {d.connected ? t('En línea') : d.lastSeenAt ? t('visto {when}', { when: relTime(d.lastSeenAt) }) : t('aún no se ha conectado')}
                </span>
                <span class="muted small dev__meta">
                  {t('Vinculado {date}', { date: fmtDateTime(d.createdAt) })}
                  {d.lastIp ? ` · ${d.lastIp}` : ''} · <span class="mono">{d.prefix}…</span>
                </span>
              </div>
              <div class="dev__actions">
                <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(d)}>
                  {t('Editar')}
                </Button>
                <Button size="sm" variant="ghost" icon="trash" class="btn--danger-text" onClick={() => revoke(d)}>
                  {t('Revocar')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <EditDeviceDialog
          device={editing}
          saved={saved}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            onChanged?.();
          }}
        />
      )}
    </Card>
  );
}

function EditDeviceDialog({ device, saved, onClose, onSaved }: { device: PairedDevice; saved: StoredConfig; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(device.name);
  const [screenId, setScreenId] = useState(device.screenId);
  const [busy, setBusy] = useState(false);
  const dirty = name !== device.name || screenId !== device.screenId;
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.updateDevice(device.id, { name: name.trim(), screenId });
      toast(t('Cambios guardados'));
      onSaved();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const options = useMemo(() => targetOptions(saved), [saved]);
  return (
    <Modal
      title={t('Editar dispositivo')}
      icon="edit"
      size="sm"
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" icon="check" loading={busy} disabled={!dirty || !name.trim()} onClick={save}>
            {t('Guardar')}
          </Button>
        </>
      }
    >
      <div class="stack">
        <Field label={t('Nombre')}>
          <TextInput value={name} maxLength={60} onValue={setName} />
        </Field>
        <Field label={options.some((o) => o.group) ? t('Qué mostrará') : t('Qué pantalla mostrará')} hint={t('El dispositivo cambia de pantalla al momento.')}>
          <Select value={screenId} options={options} onChange={(v) => setScreenId(v)} />
        </Field>
      </div>
    </Modal>
  );
}
