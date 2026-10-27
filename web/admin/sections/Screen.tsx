import { useState } from 'preact/hooks';
import { api, ApiError } from '../api';
import { toast } from '../components/feedback';
import { GoogleG, Icon } from '../components/icons';
import { PrivateLinkCard } from '../components/DisplayAccess';
import { Button, Callout, Card, Chips, Field, PageHeader, Segmented, Select, Slider, Textarea, TextInput, ToggleRow } from '../components/ui';
import { LANG_NAMES, LANGS } from '../../shared/i18n';
import { has, limit, offers } from '../caps';
import { locale, t } from '../i18n';
import { cssBytes, EMAIL_RE } from '../util';
import { MIN_PASSWORD, passwordProblem } from '../../shared/password';
import type { SectionProps } from './common';
import { PrivacyCard } from './Privacy';
import { TwoFactorCard } from '../components/TwoFactor';
import { MonthDay } from './BackgroundRules';
import type { DecorMode } from '../../shared/types';
import { OVERLAY_MAX } from '../../../server/core/decorCore.js';

const kb = (n: number) => (Math.round((n / 1024) * 10) / 10).toLocaleString(locale());

export function ScreenSection({ cfg, set, errors, screenId, saved, go }: SectionProps) {
  const s = cfg.screen;
  const cssMax = limit('customCssBytes');
  const nm = s.nightMode;
  return (
    <>
      <PageHeader scope="screen" title={t('Ajustes de la pantalla')} desc={t('Nombre, idioma, apariencia y modo noche de la pantalla.')} />
      <Card id="scr-general" scope="screen" title={t('General')} icon="monitor">
        <div class="grid grid--2">
          <Field label={t('Nombre de la pantalla')} error={errors['screen.name']}>
            <TextInput value={s.name} error={!!errors['screen.name']} onValue={(v) => set((d) => void (d.screen.name = v))} />
          </Field>
          <Field label={t('Idioma de la pantalla')}>
            <Select
              value={s.language}
              options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))}
              onChange={(v) => set((d) => void (d.screen.language = v))}
            />
          </Field>
          <Field label={t('Orientación')}>
            <Segmented
              full
              value={s.orientation}
              options={[
                { value: 'auto', label: t('Auto') },
                { value: 'landscape', label: t('Horizontal') },
                { value: 'portrait', label: t('Vertical') },
              ]}
              onChange={(v) => set((d) => void (d.screen.orientation = v))}
            />
          </Field>
          <Field label={t('Tamaño de letra')} error={errors['screen.fontScale']}>
            <Slider value={s.fontScale} min={0.7} max={1.6} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.screen.fontScale = v))} />
          </Field>
        </div>
      </Card>
      <PrivateLinkCard screenId={screenId} saved={saved} mode={saved.security?.displayAccess ?? 'open'} go={go} />
      <Card id="scr-night" scope="screen" title={t('Modo noche')} icon="moon" desc={t('Atenúa la pantalla durante la noche.')}>
        <ToggleRow label={t('Activar modo noche')} checked={nm.enabled} onChange={(v) => set((d) => void (d.screen.nightMode.enabled = v))} />
        <div class={`grid grid--3 ${nm.enabled ? '' : 'is-disabled'}`}>
          <Field label={t('Desde')} error={errors['screen.nightMode.from']}>
            <input class={`input ${errors['screen.nightMode.from'] ? 'is-invalid' : ''}`} type="time" value={nm.from} onInput={(e) => set((d) => void (d.screen.nightMode.from = e.currentTarget.value))} />
          </Field>
          <Field label={t('Hasta')} error={errors['screen.nightMode.to']}>
            <input class={`input ${errors['screen.nightMode.to'] ? 'is-invalid' : ''}`} type="time" value={nm.to} onInput={(e) => set((d) => void (d.screen.nightMode.to = e.currentTarget.value))} />
          </Field>
          <Field label={t('Brillo nocturno')}>
            <Slider value={nm.dim} min={0.05} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.screen.nightMode.dim = v))} />
          </Field>
        </div>
      </Card>
      {has('privacy') && <PrivacyCard cfg={cfg} set={set} errors={errors} go={go} />}
      <DecorationCard cfg={cfg} set={set} />
      {has('htmlOverlay') && <OverlayCard cfg={cfg} set={set} errors={errors} />}
      {has('customCss') && (
        <Card id="scr-css" scope="screen" title={t('CSS personalizado')} icon="wand" desc={t('Para usuarios avanzados: se inyecta en la pantalla.')}>
          <Field error={errors['screen.customCss']} hint={cssMax != null ? t('{used} de {max} KB', { used: kb(cssBytes(s.customCss)), max: kb(cssMax) }) : undefined}>
            <Textarea mono rows={6} value={s.customCss} placeholder={'.clock { letter-spacing: -0.02em; }'} onValue={(v) => set((d) => void (d.screen.customCss = v))} />
          </Field>
        </Card>
      )}
    </>
  );
}

/** "Decoración de temporada" (#24): Marco's own lights, snow and confetti, by the date or always one of them. */
function DecorationCard({ cfg, set }: Pick<SectionProps, 'cfg' | 'set'>) {
  const dec = cfg.screen.decoration ?? { mode: 'none' as DecorMode, snow: true };
  const upd = (patch: Partial<typeof dec>) => set((d) => void (d.screen.decoration = { ...dec, ...patch }));
  return (
    <Card id="scr-decor" scope="screen" title={t('Decoración de temporada')} icon="sparkles" desc={t('Luces, nieve o confeti que dibuja Marco, sin código. Se quedan en el borde de arriba y no tapan nada importante.')}>
      <Field label={t('Decoración')} hint={dec.mode === 'auto' ? t('Navidad del 1 de diciembre al 6 de enero, Halloween del 24 al 31 de octubre y Año Nuevo el 31 de diciembre y el 1 de enero.') : undefined}>
        <Select
          value={dec.mode}
          options={[
            { value: 'none' as DecorMode, label: t('Ninguna') },
            { value: 'auto' as DecorMode, label: t('Automática (según la fecha)') },
            { value: 'christmas' as DecorMode, label: t('Navidad') },
            { value: 'halloween' as DecorMode, label: t('Halloween') },
            { value: 'newyear' as DecorMode, label: t('Año Nuevo') },
          ]}
          onChange={(v) => upd({ mode: v })}
        />
      </Field>
      {(dec.mode === 'auto' || dec.mode === 'christmas') && (
        <ToggleRow label={t('Nieve')} hint={t('Unos pocos copos que caen despacio, con las luces de Navidad.')} checked={dec.snow} onChange={(v) => upd({ snow: v })} />
      )}
      {dec.mode !== 'none' && <p class="muted small">{t('En modo ligero, en Ahorro o con menos movimiento, las luces se quedan quietas y no hay nieve ni confeti.')}</p>}
    </Card>
  );
}

/** "HTML sobre la pantalla" (#24): the owner's HTML over the whole screen, in a frame that runs no scripts. */
function OverlayCard({ cfg, set, errors }: Pick<SectionProps, 'cfg' | 'set' | 'errors'>) {
  const ov = cfg.screen.overlay ?? { html: '', when: { type: 'always' as const } };
  const w = ov.when;
  const max = limit('htmlOverlayBytes');
  const upd = (patch: Partial<typeof ov>) => set((d) => void (d.screen.overlay = { ...ov, ...patch }));
  const err = errors['screen.overlay.html'] ?? errors['screen.overlay.when'] ?? errors['screen.overlay.when.from'] ?? errors['screen.overlay.when.to'];
  return (
    <Card id="scr-overlay" scope="screen" title={t('HTML sobre la pantalla')} icon="code" desc={t('Tu propio HTML y CSS, dibujado encima de toda la pantalla (por ejemplo, unas luces en diciembre).')}>
      <Field
        error={err}
        hint={
          <>
            {t('Los scripts no se ejecutan y solo se cargan imágenes https o data:. No recibe toques: la pantalla sigue funcionando debajo.')}{' '}
            {max != null ? t('{used} de {max} KB', { used: kb(cssBytes(ov.html)), max: kb(max) }) : t('{used} de {max} caracteres', { used: ov.html.length.toLocaleString(locale()), max: OVERLAY_MAX.toLocaleString(locale()) })}
          </>
        }
      >
        <Textarea mono rows={8} maxLength={OVERLAY_MAX} value={ov.html} placeholder={'<style>.strand { position: fixed; top: 0; }</style>\n<div class="strand">…</div>'} onValue={(v) => upd({ html: v })} />
      </Field>
      <Field label={t('Cuándo')}>
        <Segmented
          value={w.type}
          options={[
            { value: 'always' as const, label: t('Siempre') },
            { value: 'range' as const, label: t('Cada año entre dos fechas') },
          ]}
          onChange={(v) => upd({ when: v === 'range' ? { type: 'range', from: '12-01', to: '01-06' } : { type: 'always' } })}
        />
      </Field>
      {w.type === 'range' && (
        <div class="bg-rule__line">
          <span class="muted small">{t('Desde')}</span>
          <MonthDay value={w.from} onChange={(v) => upd({ when: { ...w, from: v } })} />
          <span class="muted small">{t('Hasta')}</span>
          <MonthDay value={w.to} onChange={(v) => upd({ when: { ...w, to: v } })} />
        </div>
      )}
    </Card>
  );
}

export function SecuritySection({ cfg, set, errors, me, saved, go }: SectionProps) {
  const a = cfg.auth;
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [rep, setRep] = useState('');
  const [busy, setBusy] = useState(false);
  const problem = next ? passwordProblem(next) : null;
  const problemText = problem === 'too_short' ? t('Mínimo {n} caracteres', { n: MIN_PASSWORD }) : problem === 'too_common' ? t('Demasiado común o sencilla') : problem === 'too_long' ? t('Máximo 200 caracteres') : '';
  const pwErr = problemText || (rep && rep !== next ? t('Las contraseñas no coinciden') : '');
  const change = async (e: Event) => {
    e.preventDefault();
    if (pwErr || !next || !cur) return;
    setBusy(true);
    try {
      await api.changePassword(cur, next);
      toast(t('Contraseña actualizada'));
      if (me.mustChangePassword) location.reload();
      setCur('');
      setNext('');
      setRep('');
    } catch (err) {
      const ae = err as ApiError;
      const code = (ae.body as any)?.code as string | undefined;
      toast(ae.status === 400 && code ? (code === 'too_common' ? t('Demasiado común o sencilla') : t('Mínimo {n} caracteres', { n: MIN_PASSWORD })) : [400, 401, 403].includes(ae.status) ? t('La contraseña actual no es correcta') : ae.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const emailErr = Object.keys(errors).find((k) => k.startsWith('auth.allowedGoogleEmails'));
  const pwOn = has('passwordLogin');
  const googleOn = offers('googleLogin');
  return (
    <>
      <PageHeader title={t('Seguridad')} desc={t('Quién puede entrar en este panel.')} />
      {me.user && (
        <Card>
          <div class="who">
            {me.user.picture ? <img class="avatar avatar--lg" src={me.user.picture} alt="" referrerpolicy="no-referrer" /> : <span class="avatar avatar--lg avatar--letter">{(me.user.name || me.user.email || 'A')[0].toUpperCase()}</span>}
            <div>
              <strong>{me.user.name || me.user.email}</strong>
              <div class="muted small">
                {me.user.email} · {me.user.method === 'google' ? t('sesión con Google') : me.user.method === 'account' ? t('sesión con tu cuenta') : t('sesión con contraseña')}
              </div>
            </div>
          </div>
        </Card>
      )}
      {has('openDisplayAccess') && (
        <DisplayAccessCard mode={cfg.security?.displayAccess ?? 'open'} savedMode={saved.security?.displayAccess ?? 'open'} onChange={(v) => set((d) => void (d.security = { ...(d.security ?? {}), displayAccess: v }))} go={go} />
      )}
      {googleOn && (
        <Card id="sec-google" title={t('Inicio de sesión con Google')} icon="google">
          {!me.googleConfigured && <Callout kind="warn">{t('Google no está configurado en el servidor (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).')}</Callout>}
          <Field
            label={t('Emails de Google permitidos')}
            error={emailErr ? errors[emailErr] : undefined}
            hint={t('Si la lista está vacía, el primer inicio con Google mientras tienes sesión con contraseña se añade automáticamente.')}
          >
            <Chips values={a.allowedGoogleEmails} placeholder="name@example.com" validate={(v) => EMAIL_RE.test(v)} onChange={(v) => set((d) => void (d.auth.allowedGoogleEmails = v))} />
          </Field>
          {me.googleConfigured && (
            <a class="btn btn--default" href="/auth/google/login">
              <GoogleG size={16} />
              <span>{t('Vincular mi cuenta de Google para entrar')}</span>
            </a>
          )}
        </Card>
      )}
      {pwOn && (
        <Card id="sec-password" title={t('Contraseña')} icon="key">
          {me.mustChangePassword && (
            <Callout kind="warn">{t('Estás usando la contraseña inicial. Cámbiala: hasta entonces solo se acepta desde tu red local.')}</Callout>
          )}
          {!me.mustChangePassword && me.passwordFromEnv && (
            <Callout>{t('La contraseña viene de ADMIN_PASSWORD (instalación sin asistente). Te recomendamos cambiarla aquí: después ya no se usará la del .env.')}</Callout>
          )}
          <ToggleRow
            label={t('Permitir entrar con contraseña')}
            hint={errors['auth.passwordLoginEnabled'] ? <span class="err-text">{t(errors['auth.passwordLoginEnabled'])}</span> : undefined}
            checked={a.passwordLoginEnabled}
            onChange={(v) => set((d) => void (d.auth.passwordLoginEnabled = v))}
          />
          <form class="pw-form" onSubmit={change}>
            <input type="text" name="username" autocomplete="username" value="admin" hidden readOnly />
            <Field label={t('Contraseña actual')}>
              <input class="input" type="password" autocomplete="current-password" value={cur} onInput={(e) => setCur(e.currentTarget.value)} />
            </Field>
            <div class="grid grid--2">
              <Field label={t('Nueva contraseña')} error={problemText || undefined} hint={t('Mínimo {n} caracteres; nada obvio.', { n: MIN_PASSWORD })}>
                <input class="input" type="password" autocomplete="new-password" value={next} onInput={(e) => setNext(e.currentTarget.value)} />
              </Field>
              <Field label={t('Repetir contraseña')} error={rep && rep !== next ? t('Las contraseñas no coinciden') : undefined}>
                <input class="input" type="password" autocomplete="new-password" value={rep} onInput={(e) => setRep(e.currentTarget.value)} />
              </Field>
            </div>
            <div>
              <Button type="submit" variant="primary" icon="shield" loading={busy} disabled={!!pwErr || !cur || !next || rep !== next}>
                {t('Cambiar contraseña')}
              </Button>
            </div>
          </form>
        </Card>
      )}
      {has('twoFactor') && me.user && <TwoFactorCard me={me} />}
      {(pwOn || googleOn) && (
        <Card id="sec-sessions" title={t('Sesiones')} icon="shield">
          <p class="muted small">{t('Cierra la sesión en todos los navegadores y dispositivos (también en este). Cambiar la contraseña cierra las demás sesiones automáticamente.')}</p>
          <div>
            <Button
              variant="default"
              icon="logout"
              onClick={async () => {
                try {
                  await api.logoutAll();
                } catch {
                  /* ignore */
                }
                location.reload();
              }}
            >
              {t('Cerrar sesión en todos los dispositivos')}
            </Button>
          </div>
        </Card>
      )}
      <Callout>
        {t('Las URLs de los calendarios, los tokens y las claves de las pantallas nunca se envían a otras pantallas ni aparecen en el registro de actividad.')}
      </Callout>
    </>
  );
}

function DisplayAccessCard({ mode, savedMode, onChange, go }: { mode: 'private' | 'open'; savedMode: 'private' | 'open'; onChange: (v: 'private' | 'open') => void; go: (r: string) => void }) {
  const opts: { v: 'private' | 'open'; icon: 'key' | 'wifi'; title: string; body: string; badge?: string }[] = [
    {
      v: 'private',
      icon: 'key',
      title: t('Privado'),
      badge: t('Recomendado'),
      body: t('Cada pantalla entra con su enlace privado (/d/…) o vinculándola con un código. Sin clave no se ve nada: seguro en redes compartidas o si Marco es accesible desde Internet.'),
    },
    {
      v: 'open',
      icon: 'wifi',
      title: t('Abierto (red local)'),
      body: t('Como antes de la versión 0.3: cualquiera que llegue a la dirección del servidor ve el calendario sin clave. Úsalo solo en una red doméstica de confianza.'),
    },
  ];
  return (
    <Card id="sec-display" title={t('Acceso a las pantallas')} icon="monitor" desc={t('Quién puede ver el calendario familiar en una pantalla.')}>
      <div class="access-mode" role="radiogroup" aria-label={t('Acceso a las pantallas')}>
        {opts.map((o) => (
          <button type="button" role="radio" aria-checked={mode === o.v} class={`access-mode__opt ${mode === o.v ? 'is-active' : ''}`} onClick={() => onChange(o.v)}>
            <Icon name={o.icon} size={18} />
            <div>
              <strong>
                {o.title}
                {o.badge && <span class="badge badge--soft">{o.badge}</span>}
              </strong>
              <p>{o.body}</p>
            </div>
          </button>
        ))}
      </div>
      {mode === 'open' && savedMode === 'open' && (
        <Callout kind="warn">{t('Las pantallas están en modo abierto: cualquiera que llegue a este servidor puede ver el calendario sin clave. Recomendado: enlaces privados y vinculación.')}</Callout>
      )}
      {mode === 'private' && savedMode === 'open' && (
        <Callout kind="warn">
          {t('Al guardar, las pantallas que ahora entran sin clave mostrarán un código de vinculación. Abre en cada una su enlace privado (Pantalla → Ajustes) o vincúlala desde Pantallas conectadas. En un kiosco Raspberry Pi pon el enlace privado en KIOSK_URL (~/.config/marco/kiosk.env): allí la vinculación se pierde al reiniciarse.')}
        </Callout>
      )}
      {mode === 'open' && savedMode === 'private' && (
        <Callout kind="warn">{t('Al guardar, cualquiera que llegue a la dirección del servidor podrá ver el calendario sin clave. Las pantallas que muestran un código de vinculación vuelven solas en menos de un minuto.')}</Callout>
      )}
      <p class="muted small">
        {t('Los enlaces privados están en Pantalla → Ajustes; los dispositivos vinculados, en Pantallas conectadas.')}{' '}
        <button type="button" class="link-btn" onClick={() => go('screen/scr-link')}>
          {t('Ver el enlace de esta pantalla')}
        </button>
      </p>
    </Card>
  );
}
