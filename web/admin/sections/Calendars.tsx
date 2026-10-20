import { useEffect, useState } from 'preact/hooks';
import type { CalendarSource, GoogleCalendarListItem, MicrosoftCalendarListItem, SourceKind, TestIcsResponse } from '../../shared/types';
import { api, ApiError, UNAUTHORIZED_EVENT } from '../api';
import { fetchErrorText } from '../apiErrors';
import { choiceDialog, confirmDialog, toast } from '../components/feedback';
import { GoogleG, Icon, MicrosoftLogo } from '../components/icons';
import {
  Button,
  Callout,
  Card,
  ColorPicker,
  EmojiPicker,
  Empty,
  Field,
  NumberInput,
  PageHeader,
  ReorderButtons,
  Segmented,
  Select,
  Slider,
  TextInput,
  Toggle,
  ToggleRow,
  useReorder,
} from '../components/ui';
import { atLimit, has, offers } from '../caps';
import { defaultPrivacyOf, privacyModeOptions } from './Privacy';
import { LimitNote } from '../components/LimitNote';
import { AgendaDaysField, EventStyleField, WeeksField } from '../components/PlannerFields';
import { t } from '../i18n';
import { allSourceOptions, builtinNameClashes, guessKind, HOLIDAY_PRESETS, isHttpUrl, KIND_EMOJI, moveItem, SWATCHES, uid } from '../util';
import type { SectionProps } from './common';
import { ICloudGuide, icloudUrl } from './ICloudGuide';

/** `insecureTls` is an optional extension (self-signed HTTPS feeds on the LAN); see docs/ARCHITECTURE.md. */
type Source = CalendarSource & { insecureTls?: boolean };

const KINDS: { value: SourceKind; label: string }[] = [
  { value: 'generic', label: 'General' },
  { value: 'airbnb', label: 'Alquiler vacacional (Airbnb, Booking…)' },
  { value: 'birthdays', label: 'Cumpleaños' },
  { value: 'holidays', label: 'Festivos' },
];


function nextColor(sources: CalendarSource[]) {
  const used = new Set(sources.map((s) => s.color.toLowerCase()));
  return SWATCHES.find((c) => !used.has(c)) ?? SWATCHES[sources.length % SWATCHES.length];
}

/** Adds an iCal source to a config draft ("Añadir URL iCal", the quick-add pills and the iCloud guide). */
function pushIcs(d: { calendar: { sources: CalendarSource[] } }, name = '', url = '', kind: SourceKind = 'generic') {
  if (atLimit('sources', d.calendar.sources.length)) return;
  d.calendar.sources.push({
    id: uid('c'),
    type: 'ics',
    name: name || t('Calendario {n}', { n: d.calendar.sources.length + 1 }),
    url,
    color: nextColor(d.calendar.sources),
    emoji: '',
    kind,
    enabled: true,
    refreshMin: kind === 'holidays' ? 720 : 5,
  });
}

function SourceRow({
  src,
  index,
  count,
  errors,
  update,
  remove,
  move,
  reorder,
}: {
  src: Source;
  index: number;
  count: number;
  errors: Record<string, string>;
  update: (fn: (s: Source) => void) => void;
  remove: () => void;
  move: (from: number, to: number) => void;
  reorder: ReturnType<typeof useReorder>;
}) {
  const [test, setTest] = useState<{ loading: boolean; res?: TestIcsResponse }>({ loading: false });
  const p = `source.${src.id}`;
  const urlValid = src.type === 'ics' && !!src.url && isHttpUrl(src.url, true);
  /** The server kept the stored URL back (no recent sign-in): the field stays empty unless a new URL is typed. */
  const hidden = src.type === 'ics' && !!src.urlHidden && !src.url;
  const runTest = async () => {
    if (!src.url) return;
    setTest({ loading: true });
    try {
      const res = await api.testIcs(src.url.trim(), src.insecureTls);
      setTest({ loading: false, res });
    } catch (e) {
      setTest({ loading: false, res: { ok: false, error: (e as ApiError).message } });
    }
  };
  return (
    <div class={`src ${src.enabled ? '' : 'is-off'}`} {...(reorder.rowProps(index) as any)} style={{ '--src-color': src.color } as any}>
      <div class="src__head">
        <span class="grip" title={t('Arrastra para reordenar')} {...reorder.handleProps(index)}>
          <Icon name="grip" size={16} />
        </span>
        <EmojiPicker value={src.emoji ?? ''} allowNone onChange={(v) => update((s) => void (s.emoji = v))} />
        <ColorPicker compact value={src.color} error={!!errors[`${p}.color`]} onChange={(v) => update((s) => void (s.color = v ?? s.color))} />
        <TextInput
          class="src__name"
          value={src.name}
          error={!!errors[`${p}.name`]}
          placeholder={t('Nombre')}
          onValue={(v) => update((s) => void (s.name = v))}
        />
        <span class={`badge ${src.type !== 'ics' ? 'badge--google' : ''}`}>
          {src.type === 'google' ? <GoogleG size={12} /> : src.type === 'microsoft' ? <MicrosoftLogo size={12} /> : 'ICS'}
        </span>
        <Toggle checked={src.enabled} onChange={(v) => update((s) => void (s.enabled = v))} label={t('Activo')} />
        <ReorderButtons index={index} count={count} onMove={move} />
        <button type="button" class="icon-btn icon-btn--danger" onClick={remove} aria-label={t('Eliminar')} title={t('Eliminar')}>
          <Icon name="trash" size={16} />
        </button>
      </div>
      <div class="src__body">
        {src.type === 'ics' ? (
          <Field
            error={errors[`${p}.url`]}
            class="src__url"
            hint={
              hidden ? (
                <>
                  {t('Por seguridad, la dirección solo se muestra si has iniciado sesión hace poco.')}{' '}
                  <button type="button" class="link-btn" onClick={() => window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))}>
                    {t('Volver a iniciar sesión')}
                  </button>
                </>
              ) : undefined
            }
          >
            <TextInput
              mono
              value={src.url ?? ''}
              placeholder={hidden ? t('Dirección guardada (oculta)') : 'https://…/calendar.ics'}
              error={!!errors[`${p}.url`]}
              onValue={(v) => {
                update((s) => {
                  s.url = v;
                  if (s.kind === 'generic' && /airbnb|booking|reservations/i.test(v)) s.kind = 'airbnb';
                });
                setTest({ loading: false });
              }}
              prefix={<Icon name="link" size={14} />}
              suffix={
                src.url ? (
                  <span class={urlValid ? 'ok-text' : 'err-text'} title={urlValid ? t('URL válida') : t('URL no válida')}>
                    <Icon name={urlValid ? 'check' : 'x'} size={14} />
                  </span>
                ) : undefined
              }
            />
          </Field>
        ) : src.type === 'microsoft' ? (
          <div class="src__google">
            <MicrosoftLogo size={14} />
            <span class="muted">{src.microsoftAccount}</span>
          </div>
        ) : (
          <div class="src__google">
            <GoogleG size={14} />
            <span class="muted">{src.googleAccount}</span>
            <span class="mono small muted">{src.googleCalendarId}</span>
          </div>
        )}
        <div class="src__opts">
          <label class="mini-field">
            <span>{t('Tipo')}</span>
            <div class="src__kind">
              <Select value={src.kind} options={KINDS.map((k) => ({ ...k, label: `${KIND_EMOJI[k.value] || '📅'} ${t(k.label)}` }))} onChange={(v) => update((s) => void (s.kind = v))} />
            </div>
          </label>
          {has('privacy') && (
            <label class="mini-field" title={t('Qué se ve de este calendario en las pantallas en modo privado')}>
              <span>{t('En modo privado')}</span>
              <div class="src__kind">
                <Select value={src.privacy ?? defaultPrivacyOf(src.kind)} options={privacyModeOptions()} onChange={(v) => update((s) => void (s.privacy = v))} />
              </div>
            </label>
          )}
          <label class="mini-field" title={t('Cada cuántos minutos se vuelve a descargar')}>
            <span>{t('Actualizar cada')}</span>
            <NumberInput value={src.refreshMin} min={1} max={1440} suffix="min" error={!!errors[`${p}.refreshMin`]} onValue={(v) => update((s) => void (s.refreshMin = v))} />
          </label>
          {src.type === 'ics' && (has('insecureTls') || !!src.insecureTls) && (
            <label class="mini-toggle" title={t('Acepta certificados HTTPS autofirmados (solo en tu red local)')}>
              <Toggle size="sm" checked={!!src.insecureTls} onChange={(v) => update((s) => void (s.insecureTls = v))} />
              <span>{t('Certificado autofirmado')}</span>
            </label>
          )}
          {src.type === 'ics' && (
            <Button size="sm" icon="play" loading={test.loading} disabled={!urlValid} onClick={runTest}>
              {t('Probar')}
            </Button>
          )}
        </div>
        {test.res && (
          <div class={`test-result ${test.res.ok ? 'is-ok' : 'is-err'}`}>
            {test.res.ok ? (
              <>
                <strong>
                  <Icon name="check" size={14} /> {t('{n} eventos encontrados', { n: test.res.count ?? 0 })}
                </strong>
                {!!test.res.sample?.length && (
                  <ul>
                    {test.res.sample.slice(0, 5).map((s) => (
                      <li>{s}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <span>
                <Icon name="alert" size={14} /> {fetchErrorText(test.res.error) || t('No se pudo leer el calendario')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A linked account and one of its calendars, the same for every provider. */
interface LinkedAccount {
  email: string;
  name?: string;
  picture?: string;
  /** Microsoft: false when it was linked before Marco asked for To Do access (it can be reconnected in place) */
  tasks?: boolean;
}
interface LinkedCalendar {
  id: string;
  name: string;
  color?: string;
  primary?: boolean;
  /** owner address of a calendar someone else shared with the account */
  owner?: string;
}

type ProviderId = 'google' | 'microsoft';

/** What differs between Google and Microsoft in the linked accounts card. Strings are Spanish keys for t(). */
interface Provider {
  id: ProviderId;
  label: string;
  /** the server can link accounts of this provider for this user (me.googleConfigured / me.microsoftConfigured) */
  configured: boolean;
  leaveBody: string;
  disconnectBody: string;
  connectPath: string;
  accounts: () => Promise<LinkedAccount[]>;
  calendars: (email: string) => Promise<LinkedCalendar[]>;
  remove: (email: string) => Promise<unknown>;
  accountOf: (s: CalendarSource) => string | undefined;
  calendarOf: (s: CalendarSource) => string | undefined;
  newSource: (email: string, c: LinkedCalendar) => Partial<CalendarSource>;
}

function googleProvider(me: SectionProps['me']): Provider {
  return {
    id: 'google',
    label: 'Google',
    configured: offers('googleCalendar') && !!me.googleConfigured,
    leaveBody: 'Vas a salir a Google para vincular la cuenta. ¿Guardamos primero los cambios pendientes?',
    disconnectBody: 'Se dejarán de mostrar sus calendarios en la pantalla.',
    connectPath: '/auth/google/connect',
    accounts: () => api.googleAccounts(),
    calendars: async (email) =>
      (await api.googleCalendars(email)).map((c: GoogleCalendarListItem) => ({ id: c.id, name: c.summary, color: c.backgroundColor, primary: c.primary })),
    remove: (email) => api.removeGoogleAccount(email),
    accountOf: (s) => (s.type === 'google' ? s.googleAccount : undefined),
    calendarOf: (s) => (s.type === 'google' ? s.googleCalendarId : undefined),
    newSource: (email, c) => ({ type: 'google', googleAccount: email, googleCalendarId: c.id }),
  };
}

function microsoftProvider(me: SectionProps['me']): Provider {
  return {
    id: 'microsoft',
    label: 'Microsoft',
    configured: has('microsoftCalendar') && !!me.microsoftConfigured,
    leaveBody: 'Vas a salir a Microsoft para vincular la cuenta. ¿Guardamos primero los cambios pendientes?',
    disconnectBody:
      'Se dejarán de mostrar sus calendarios en la pantalla y Marco borrará su acceso. Para retirar también el permiso en Microsoft, entra en account.live.com/consent/Manage (cuenta personal) o en myapps.microsoft.com (cuenta del trabajo o del centro educativo).',
    connectPath: '/auth/microsoft/connect',
    accounts: () => api.microsoftAccounts(),
    calendars: async (email) =>
      (await api.microsoftCalendars(email)).map((c: MicrosoftCalendarListItem) => ({ id: c.id, name: c.name, color: c.color, primary: c.isDefault, owner: c.owner })),
    remove: (email) => api.removeMicrosoftAccount(email),
    accountOf: (s) => (s.type === 'microsoft' ? s.microsoftAccount : undefined),
    calendarOf: (s) => (s.type === 'microsoft' ? s.microsoftCalendarId : undefined),
    newSource: (email, c) => ({ type: 'microsoft', microsoftAccount: email, microsoftCalendarId: c.id }),
  };
}

/** One linked account of any provider, as listed in the card. */
interface Linked extends LinkedAccount {
  provider: ProviderId;
}
const linkKey = (a: { provider: ProviderId; email: string }) => `${a.provider}:${a.email}`;

/**
 * Linked accounts (Google and Microsoft) in one card: "Link account" asks which provider, and every linked account is
 * listed one below the other with its calendars to pick from. Apple iCloud is always in the chooser: it opens a guide
 * to add the calendar's public link as an iCal source (no account to link, no server credentials).
 */
function LinkedAccounts({ cfg, set, dirty, save, me }: SectionProps) {
  const all = [googleProvider(me), microsoftProvider(me)];
  const providers = all.filter((p) => p.configured);
  const byId = (id: ProviderId) => all.find((p) => p.id === id)!;
  const configuredKey = providers.map((p) => p.id).join(',');
  const [accounts, setAccounts] = useState<Linked[] | null>(null);
  const [cals, setCals] = useState<Record<string, LinkedCalendar[] | 'error' | undefined>>({});
  const [err, setErr] = useState('');
  const [icloud, setIcloud] = useState(false);

  const load = async () => {
    const lists = await Promise.allSettled(providers.map(async (p) => (await p.accounts()).map((a) => ({ ...a, provider: p.id }) as Linked)));
    const list = lists.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    const failed = lists.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    setAccounts(list);
    setErr(failed ? (failed.reason as ApiError).message : '');
    for (const a of list) {
      byId(a.provider)
        .calendars(a.email)
        .then((c) => setCals((m) => ({ ...m, [linkKey(a)]: c })))
        .catch(() => setCals((m) => ({ ...m, [linkKey(a)]: 'error' })));
    }
  };
  useEffect(() => {
    if (providers.length) load();
    else setAccounts([]);
  }, [configuredKey]);

  const go = async (p: Provider, account = '') => {
    if (dirty) {
      const ok = await confirmDialog({
        title: t('Guardar cambios antes de continuar'),
        body: t(p.leaveBody),
        confirm: t('Guardar y continuar'),
      });
      if (!ok) return;
      if (!(await save())) return;
    }
    window.location.href = account ? `${p.connectPath}?account=${encodeURIComponent(account)}` : p.connectPath;
  };

  /** Ask which provider (Apple iCloud is always there); with no account provider set up, straight to the iCloud guide. */
  const connect = async () => {
    if (!providers.length) return setIcloud(true);
    const choice = await choiceDialog<ProviderId | 'apple'>({
      title: t('Vincular cuenta'),
      body: t('¿Qué cuenta quieres vincular?'),
      choices: [
        ...providers.map((p) => ({ value: p.id, label: p.label, kind: 'default' as const, icon: p.id })),
        { value: 'apple' as const, label: 'Apple iCloud', kind: 'default' as const, icon: 'apple' as const },
      ],
      closeX: true,
    });
    if (choice === 'apple') setIcloud(true);
    else if (choice) await go(byId(choice));
  };

  const ofAccount = (s: CalendarSource, a: Linked) => byId(a.provider).accountOf(s) === a.email;
  const isOn = (a: Linked, id: string) => cfg.calendar.sources.some((s) => ofAccount(s, a) && byId(a.provider).calendarOf(s) === id);

  const disconnect = async (a: Linked) => {
    const p = byId(a.provider);
    const ok = await confirmDialog({
      title: t('Desvincular {email}', { email: a.email }),
      body: t(p.disconnectBody),
      confirm: t('Desvincular'),
      danger: true,
    });
    if (!ok) return;
    try {
      await p.remove(a.email);
      set((d) => {
        d.calendar.sources = d.calendar.sources.filter((s) => !ofAccount(s, a));
        // its Microsoft To Do lists go too
        if (a.provider === 'microsoft' && d.todo.lists) d.todo.lists = d.todo.lists.filter((l) => l.microsoftAccount !== a.email);
      });
      toast(t('Cuenta desvinculada. Guarda para aplicar los cambios en los calendarios.'), 'info');
      load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  const toggleCal = (a: Linked, c: LinkedCalendar, on: boolean) =>
    set((d) => {
      const p = byId(a.provider);
      if (on) {
        if (isOn(a, c.id) || atLimit('sources', d.calendar.sources.length)) return;
        d.calendar.sources.push({
          id: uid('c'),
          type: p.id,
          name: c.name,
          color: c.color && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : nextColor(d.calendar.sources),
          emoji: '',
          kind: guessKind(`${c.name} ${c.id}`),
          enabled: true,
          refreshMin: 5,
          ...p.newSource(a.email, c),
        } as CalendarSource);
      } else {
        d.calendar.sources = d.calendar.sources.filter((s) => !(ofAccount(s, a) && p.calendarOf(s) === c.id));
      }
    });

  const desc =
    providers.length > 1
      ? t('Vincula cuentas de Google o de Microsoft (Outlook.com, Hotmail, Microsoft 365) y elige qué calendarios mostrar.')
      : providers[0]?.id === 'microsoft'
        ? t('Vincula una cuenta de Outlook.com, Hotmail o Microsoft 365 y elige qué calendarios mostrar.')
        : providers[0]?.id === 'google'
          ? t('Vincula una cuenta de Google y elige qué calendarios mostrar.')
          : t('Añade un calendario de Apple iCloud con su enlace público.');
  const hasMicrosoft = !!accounts?.some((a) => a.provider === 'microsoft');

  return (
    <Card
      title={t('Cuentas vinculadas')}
      id="cal-accounts"
      scope="global"
      icon="link"
      desc={desc}
      actions={
        <Button icon="plus" variant="primary" size="sm" onClick={connect}>
          {providers.length ? t('Vincular cuenta') : t('Añadir iCloud')}
        </Button>
      }
    >
      {icloud && (
        <ICloudGuide
          onClose={() => setIcloud(false)}
          onAdd={(name, url) => set((d) => pushIcs(d, name, url, 'generic'))}
          exists={(url) => cfg.calendar.sources.some((s) => s.type === 'ics' && !!s.url && icloudUrl(s.url) === url)}
          disabled={atLimit('sources', cfg.calendar.sources.length)}
          note={<LimitNote name="sources" count={cfg.calendar.sources.length} />}
        />
      )}
      {providers.length === 0 ? (
        (offers('googleCalendar') || offers('microsoftCalendar')) && (
          <Callout kind="warn">
            {t('Para vincular cuentas, añade GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET (Google) o MICROSOFT_CLIENT_ID y MICROSOFT_CLIENT_SECRET (Microsoft) al archivo .env y reinicia. Mientras tanto puedes usar la URL iCal secreta de tu calendario.')}
          </Callout>
        )
      ) : accounts === null ? (
        <div class="skeleton-list">
          <div class="skeleton" />
          <div class="skeleton" />
        </div>
      ) : accounts.length === 0 ? (
        <Empty icon="calendar" title={err ? t('No se pudieron cargar las cuentas') : t('Ninguna cuenta vinculada')}>
          {err ||
            (providers.length > 1
              ? t('Pulsa “Vincular cuenta” para dar acceso de solo lectura a tu calendario de Google o de Outlook.')
              : providers[0].id === 'microsoft'
                ? t('Pulsa “Vincular cuenta” para dar acceso de solo lectura a tu calendario de Outlook.')
                : t('Pulsa “Vincular cuenta” para dar acceso de solo lectura a tu Google Calendar.'))}
        </Empty>
      ) : (
        <div class="gaccounts">
          {accounts.map((a) => {
            const list = cals[linkKey(a)];
            return (
              <div class="gaccount">
                <div class="gaccount__head">
                  {a.picture ? <img class="avatar" src={a.picture} alt="" referrerpolicy="no-referrer" /> : <span class="avatar avatar--letter">{(a.name || a.email)[0].toUpperCase()}</span>}
                  <div class="gaccount__who">
                    <strong>{a.name || a.email}</strong>
                    <span class="muted small">
                      {a.provider === 'microsoft' ? <MicrosoftLogo size={12} /> : <GoogleG size={12} />} {byId(a.provider).label}
                      {a.name && a.name !== a.email ? ` · ${a.email}` : ''}
                    </span>
                  </div>
                  <Button size="sm" variant="ghost" icon="x" onClick={() => disconnect(a)}>
                    {t('Desvincular')}
                  </Button>
                </div>
                {a.provider === 'microsoft' && a.tasks === false && (
                  <Callout kind="info">
                    {t('Vuelve a vincular la cuenta para ver tus listas de To Do.')}{' '}
                    <Button size="sm" variant="ghost" icon="link" onClick={() => go(byId('microsoft'), a.email)}>
                      {t('Volver a vincular')}
                    </Button>
                  </Callout>
                )}
                {list === undefined ? (
                  <div class="skeleton" />
                ) : list === 'error' ? (
                  <Callout kind="error">{t('No se pudo leer la lista de calendarios. Vuelve a vincular la cuenta.')}</Callout>
                ) : (
                  <ul class="gcal-list">
                    {list.map((c) => {
                      const on = isOn(a, c.id);
                      return (
                        <li>
                          <label class={`gcal ${on ? 'is-on' : ''}`}>
                            <input type="checkbox" checked={on} disabled={!on && atLimit('sources', cfg.calendar.sources.length)} onChange={(e) => toggleCal(a, c, e.currentTarget.checked)} />
                            <span class="check-box">
                              <Icon name="check" size={12} />
                            </span>
                            <span class="dot-color" style={{ background: c.color || '#888' }} />
                            <span class="gcal__name">{c.name}</span>
                            {c.owner && <span class="muted small">{c.owner}</span>}
                            {c.primary && <span class="badge badge--soft">{t('Principal')}</span>}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
      {hasMicrosoft && (
        <p class="muted small">
          {t('Marco solo lee tus calendarios. Para retirar el permiso también en Microsoft:')}{' '}
          <a href="https://account.live.com/consent/Manage" target="_blank" rel="noopener noreferrer">
            {t('cuenta personal')}
          </a>
          {' · '}
          <a href="https://myapps.microsoft.com" target="_blank" rel="noopener noreferrer">
            {t('cuenta del trabajo o del centro educativo')}
          </a>
        </p>
      )}
    </Card>
  );
}

/** Per-screen: which sources this screen shows (`calendar.sourceIds`: null = all, incl. new ones). */
function ScreenSourcesCard({ cfg, set, full }: SectionProps) {
  const ids = cfg.calendar.sourceIds ?? null;
  const opts = allSourceOptions(full, { includeDisabled: true });
  const disabled = new Set(full.calendar.sources.filter((s) => !s.enabled).map((s) => s.id));
  if (!full.localEvents.enabled) disabled.add('local');
  if (!full.birthdays.enabled) disabled.add('birthdays');
  const all = ids === null;
  const toggle = (id: string, on: boolean) =>
    set((d) => {
      const cur = d.calendar.sourceIds ?? opts.map((o) => o.id);
      d.calendar.sourceIds = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
    });
  return (
    <Card
      id="cal-screen-sources"
      scope="screen"
      title={t('Calendarios en esta pantalla')}
      icon="eye"
      desc={full.screens.length > 1 ? t('Por ejemplo: la cocina solo con la familia y los cumpleaños; la entrada con las reservas.') : t('Elige qué calendarios se muestran.')}
    >
      <Segmented
        full
        value={all ? 'all' : 'some'}
        options={[
          { value: 'all', label: t('Todos los calendarios') },
          { value: 'some', label: t('Solo algunos') },
        ]}
        onChange={(v) => set((d) => void (d.calendar.sourceIds = v === 'all' ? null : opts.filter((o) => !disabled.has(o.id)).map((o) => o.id)))}
      />
      {all ? (
        <p class="muted small">{t('Se muestran todos los calendarios activos, también los que añadas en el futuro.')}</p>
      ) : (
        <ul class="gcal-list screen-src-list">
          {opts.map((o) => {
            const on = (ids ?? []).includes(o.id);
            return (
              <li>
                <label class={`gcal ${on ? 'is-on' : ''} ${disabled.has(o.id) ? 'is-dim' : ''}`}>
                  <input type="checkbox" checked={on} onChange={(e) => toggle(o.id, e.currentTarget.checked)} />
                  <span class="check-box">
                    <Icon name="check" size={12} />
                  </span>
                  <span class="dot-color" style={{ background: o.color }} />
                  <span class="gcal__name">
                    {o.emoji ? `${o.emoji} ` : ''}
                    {o.name}
                  </span>
                  {disabled.has(o.id) && <span class="badge badge--soft">{t('Desactivado')}</span>}
                  {(o.id === 'local' || o.id === 'birthdays') && !builtinNameClashes(full, o.id) && <span class="badge badge--soft">{o.id === 'local' ? t('Eventos locales') : t('Cumpleaños')}</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {!all && (ids ?? []).length === 0 && <Callout kind="warn">{t('No has marcado ningún calendario: esta pantalla no mostrará eventos.')}</Callout>}
    </Card>
  );
}

export function CalendarsSection(props: SectionProps) {
  const { cfg, set, errors } = props;
  const c = cfg.calendar;
  const sources = c.sources as Source[];
  const move = (from: number, to: number) => set((d) => void (d.calendar.sources = moveItem(d.calendar.sources, from, to)));
  const reorder = useReorder(move);

  const atMax = atLimit('sources', sources.length);
  const addIcs = (name = '', url = '', kind: SourceKind = 'generic') => set((d) => pushIcs(d, name, url, kind));

  const removeSource = async (s: Source) => {
    const ok = await confirmDialog({ title: t('Eliminar “{name}”', { name: s.name || 'calendario' }), body: t('Sus eventos dejarán de mostrarse.'), confirm: t('Eliminar'), danger: true });
    if (ok) set((d) => void (d.calendar.sources = d.calendar.sources.filter((x) => x.id !== s.id)));
  };

  return (
    <>
      <PageHeader
        title={t('Calendarios')}
        desc={
          offers('microsoftCalendar')
            ? offers('googleCalendar')
              ? t('Conecta calendarios iCal, Google y Microsoft, y decide cómo se muestran.')
              : t('Conecta calendarios iCal y Microsoft, y decide cómo se muestran.')
            : offers('googleCalendar')
              ? t('Conecta calendarios iCal y Google, y decide cómo se muestran.')
              : t('Conecta calendarios iCal y decide cómo se muestran.')
        }
      />

      <Card
        title={t('Calendarios conectados')}
        id="cal-sources"
        scope="global"
        icon="link"
        desc={t('Cada calendario tiene su color y emoji. El orden define la prioridad en la leyenda.')}
        actions={
          <Button icon="plus" variant="primary" size="sm" disabled={atMax} onClick={() => addIcs()}>
            {t('Añadir URL iCal')}
          </Button>
        }
      >
        {sources.length === 0 ? (
          <Empty icon="calendar" title={t('Aún no hay calendarios')}>
            {offers('googleCalendar') && offers('microsoftCalendar')
              ? t('Pega la URL .ics de tu calendario (Airbnb, Booking, Google, iCloud, Outlook…) o vincula una cuenta de Google o de Microsoft.')
              : offers('googleCalendar')
                ? t('Pega la URL .ics de tu calendario (Airbnb, Booking, Google, iCloud, Outlook…) o vincula una cuenta de Google.')
                : offers('microsoftCalendar')
                  ? t('Pega la URL .ics de tu calendario (Airbnb, Booking, Google, iCloud, Outlook…) o vincula una cuenta de Microsoft.')
                  : t('Pega la URL .ics de tu calendario (Airbnb, Booking, Google, iCloud, Outlook…).')}
          </Empty>
        ) : (
          <div class="src-list">
            {sources.map((s, i) => (
              <SourceRow
                key={s.id}
                src={s}
                index={i}
                count={sources.length}
                errors={errors}
                reorder={reorder}
                move={move}
                remove={() => removeSource(s)}
                update={(fn) =>
                  set((d) => {
                    const target = d.calendar.sources.find((x) => x.id === s.id);
                    if (target) fn(target as Source);
                  })
                }
              />
            ))}
          </div>
        )}
        <LimitNote name="sources" count={sources.length} />
        <div class="quick-add">
          <span class="muted small">{t('Añadir rápido:')}</span>
          {HOLIDAY_PRESETS.filter((p) => !sources.some((s) => s.url === p.url)).map((p) => (
            <button type="button" class="pill" disabled={atMax} onClick={() => addIcs(t(p.name), p.url, 'holidays')}>
              🎉 {t(p.name)}
            </button>
          ))}
          <button type="button" class="pill" disabled={atMax} onClick={() => addIcs('Airbnb', '', 'airbnb')}>
            🏠 {t('Reservas Airbnb')}
          </button>
        </div>
      </Card>

      <LinkedAccounts {...props} />

      <ScreenSourcesCard {...props} />

      <Card id="cal-view" scope="screen" title={t('Vista del calendario')} icon="calendar">
        <ToggleRow label={t('Mostrar calendario')} checked={c.enabled} onChange={(v) => set((d) => void (d.calendar.enabled = v))} />
        <div class={`stack ${c.enabled ? '' : 'is-disabled'}`}>
          <div class="grid grid--2">
            <Field label={t('Tipo de vista')}>
              <Segmented
                full
                value={c.view}
                options={[
                  { value: 'month', label: t('Mensual') },
                  { value: 'week', label: t('Semanal') },
                  { value: 'agenda', label: t('Agenda') },
                ]}
                onChange={(v) => set((d) => void (d.calendar.view = v))}
              />
            </Field>
            <Field
              label={t('El calendario empieza en')}
              hint={c.startOn === 'today' ? t('Sin días pasados: el calendario empieza siempre por hoy y avanza un día cada medianoche.') : undefined}
            >
              <Segmented<number | 'today'>
                full
                value={c.startOn === 'today' ? 'today' : c.weekStart}
                options={[
                  { value: 1, label: t('Lunes') },
                  { value: 0, label: t('Domingo') },
                  { value: 'today', label: t('Hoy') },
                ]}
                onChange={(v) =>
                  set((d) => {
                    // weekStart stays as it was with 'today' (the menus of the week still start on it)
                    if (v === 'today') d.calendar.startOn = 'today';
                    else {
                      d.calendar.startOn = 'week';
                      d.calendar.weekStart = v;
                    }
                  })
                }
              />
            </Field>
            <WeeksField cfg={props.cfg} set={set} error={errors['calendar.weeks']} />
            <EventStyleField cfg={props.cfg} set={set} />
            {(c.view === 'agenda' || props.cfg.layout.preset === 'agenda') && <AgendaDaysField cfg={props.cfg} set={set} />}
            <Field
              label={t('Máx. eventos visibles por día')}
              hint={
                c.eventStyle === 'cards'
                  ? t('Con tarjetas, cada día muestra las que caben en su alto. Este número cuenta para elegir las semanas en Auto.')
                  : c.compactBusyDays === true
                    ? t('Los días con más eventos pasan a líneas cortas y los muestran todos. Con 3 o 4, los días normales se ven grandes.')
                    : t('Los eventos que no caben se muestran por turnos o con “+N”.')
              }
              error={errors['calendar.maxEventsPerDay']}
            >
              <Slider value={c.maxEventsPerDay} min={1} max={8} step={1} onChange={(v) => set((d) => void (d.calendar.maxEventsPerDay = v))} />
            </Field>
          </div>
          <div class="toggle-grid">
            <ToggleRow icon="📍" label={t('Ubicación del evento')} checked={c.showLocation} onChange={(v) => set((d) => void (d.calendar.showLocation = v))} />
            <ToggleRow icon="⏱️" label={t('Hora de fin')} checked={c.showEndTime} onChange={(v) => set((d) => void (d.calendar.showEndTime = v))} />
            <ToggleRow icon="🔢" label={t('“Día X de Y” en eventos largos')} checked={c.showDayXofY} onChange={(v) => set((d) => void (d.calendar.showDayXofY = v))} />
            <ToggleRow icon="🏷️" label={t('Leyenda de calendarios')} checked={c.showLegend} onChange={(v) => set((d) => void (d.calendar.showLegend = v))} />
            <ToggleRow icon="⏭️" label={t('Solo eventos actuales y futuros')} checked={c.hidePast} onChange={(v) => set((d) => void (d.calendar.hidePast = v))} />
            <ToggleRow
              icon="↔️"
              label={t('Desplazar los textos largos')}
              hint={t('Los títulos que no caben se deslizan despacio para leerlos enteros: en el calendario, junto al reloj, en las cuentas atrás y en las noticias. Los que ocupan varias líneas suben línea a línea.')}
              checked={c.marquee !== false}
              onChange={(v) => set((d) => void (d.calendar.marquee = v))}
            />
            <ToggleRow
              icon="🔁"
              label={t('Rotar los días con muchos eventos')}
              hint={t('Si en un día no caben todos, se van mostrando por turnos.')}
              checked={c.rotateBusyDays !== false}
              onChange={(v) => set((d) => void (d.calendar.rotateBusyDays = v))}
            />
            <ToggleRow
              icon="🗜️"
              label={t('Días llenos en compacto')}
              hint={
                c.eventStyle === 'cards'
                  ? t('Con el estilo de tarjetas no se usa: las tarjetas ya se apilan en cada día.')
                  : t('Si en un día no caben sus eventos, se muestran en líneas pequeñas, y las semanas con más eventos ocupan más alto. Lo que aun así no cabe se muestra por turnos o con “+N”.')
              }
              checked={c.compactBusyDays === true}
              onChange={(v) => set((d) => void (d.calendar.compactBusyDays = v))}
            />
          </div>
        </div>
      </Card>
    </>
  );
}
