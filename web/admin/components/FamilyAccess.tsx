// Accesos de la familia (#16): each person of the household gets a dashboard of their own on the phone (/my), opened
// with a private link or authorised with a code shown on one of the screens. The admin picks what each person may do
// and can take it back at any moment (server/routes/familyAccess.js, server/core/familyAccessCore.js). The people are
// live state (GET /api/admin/family-access), not config: every change here applies at once, without the save bar.
import { useEffect, useState } from 'preact/hooks';
import { MAX_PEOPLE, NAME_MAX } from '../../../server/core/familyAccessCore.js';
import type { FamilyAccessListResponse, FamilyAccessPerms, FamilyAccessPerson, StoredConfig } from '../../shared/types';
import { api, ApiError } from '../api';
import { shareOrigin } from './DisplayAccess';
import { confirmDialog, toast } from './feedback';
import { Icon } from './icons';
import { CopyField, Qr } from './share';
import { Button, Callout, Card, Empty, Field, Modal, Select, TextInput, ToggleRow } from './ui';
import { relTime, t } from '../i18n';

type PermKey = Exclude<keyof FamilyAccessPerms, 'messageScreens'>;

/** The permissions in the order the admin lists them, with their labels. */
const PERMS: { key: PermKey; emoji: string; label: string; hint: string }[] = [
  { key: 'message', emoji: '💬', label: 'Enviar mensajes a las pantallas', hint: 'Salen como un aviso con su nombre, durante el tiempo que elija.' },
  { key: 'privacy', emoji: '🔒', label: 'Activar y quitar el modo privado', hint: 'En todas las pantallas a la vez.' },
  { key: 'night', emoji: '🌙', label: 'Cambiar entre noche, día y automático', hint: 'En todas las pantallas a la vez.' },
  { key: 'todo', emoji: '✅', label: 'Añadir tareas', hint: 'A la lista de tareas de casa.' },
  { key: 'events', emoji: '📅', label: 'Añadir eventos al calendario local', hint: 'Con fecha, todo el día o con hora.' },
];

/** Readable text of an error of these routes. */
function errorText(e: unknown): string {
  const err = e as ApiError;
  const code = (err?.body as { code?: string } | null)?.code ?? err?.message;
  const map: Record<string, string> = {
    name_required: 'Escribe un nombre.',
    unknown_member: 'Guarda los cambios de Familia antes de elegir a esa persona.',
    too_many_people: 'Has llegado al máximo de personas.',
    unknown_screen: 'Guarda la pantalla antes de mostrar un código en ella.',
    rate_limited: 'Demasiados códigos seguidos. Espera unos minutos.',
    not_found: 'Ya no existe.',
  };
  return t(map[code ?? ''] ?? err?.message ?? 'Error');
}

/** What a person may do, as a short line ("Mensajes · Modo privado"). */
function permSummary(p: FamilyAccessPerms): string {
  const names: Record<PermKey, string> = { message: 'Mensajes', privacy: 'Modo privado', night: 'Noche y día', todo: 'Tareas', events: 'Eventos' };
  const on = PERMS.filter((x) => p[x.key]).map((x) => t(names[x.key]));
  return on.length ? on.join(' · ') : t('Sin permisos todavía');
}

export function FamilyAccessCard({ saved }: { saved: StoredConfig }) {
  const [data, setData] = useState<FamilyAccessListResponse | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<FamilyAccessPerson | 'new' | null>(null);
  /** The private link of one person, shown once after it is made. */
  const [fresh, setFresh] = useState<{ id: string; url: string } | null>(null);
  const origin = shareOrigin(data) || location.origin;

  const reload = () =>
    api
      .familyAccess()
      .then((d) => {
        setData(d);
        setErr('');
      })
      .catch((e) => setErr(errorText(e)));
  useEffect(() => {
    void reload();
  }, [saved.revision]);

  const put = (p: FamilyAccessPerson) => setData((d) => (d ? { ...d, people: d.people.some((x) => x.id === p.id) ? d.people.map((x) => (x.id === p.id ? p : x)) : [...d.people, p] } : d));

  const people = data?.people ?? [];
  const max = data?.max ?? MAX_PEOPLE;
  return (
    <Card
      id="fam-people"
      scope="global"
      title={t('Accesos de la familia')}
      icon="users"
      desc={t('Cada persona tiene su propio panel en el móvil, sin la contraseña del panel. Tú eliges qué puede hacer cada una y puedes quitarle el acceso cuando quieras.')}
      actions={
        <Button size="sm" variant="primary" icon="plus" disabled={!data || people.length >= max} onClick={() => setEdit('new')}>
          {t('Añadir persona')}
        </Button>
      }
    >
      {err && !data ? (
        <Callout kind="error">{err}</Callout>
      ) : !data ? (
        <div class="skeleton skeleton--card" />
      ) : !people.length ? (
        <Empty icon="users" title={t('Nadie tiene acceso todavía')}>
          {t('Añade a una persona, elige qué puede hacer y envíale su enlace, o muéstrale un código en una pantalla.')}
        </Empty>
      ) : (
        <ul class="fa-list">
          {people.map((p) => (
            <PersonRow
              key={p.id}
              p={p}
              saved={saved}
              origin={origin}
              fresh={fresh?.id === p.id ? fresh.url : ''}
              onFresh={(url) => setFresh(url ? { id: p.id, url } : null)}
              onEdit={() => setEdit(p)}
              onChange={put}
              onGone={() => setData((d) => (d ? { ...d, people: d.people.filter((x) => x.id !== p.id) } : d))}
            />
          ))}
        </ul>
      )}
      <p class="muted small">{t('Lo que permitas se comprueba en el servidor en cada acción. Nadie con este acceso entra en el panel, ni ve calendarios, fotos o contraseñas.')}</p>
      {edit && (
        <PersonDialog
          person={edit === 'new' ? null : edit}
          saved={saved}
          onClose={() => setEdit(null)}
          onSaved={(p, link) => {
            put(p);
            if (link) setFresh({ id: p.id, url: `${origin}${link}` });
            setEdit(null);
          }}
        />
      )}
    </Card>
  );
}

function PersonRow({ p, saved, origin, fresh, onFresh, onEdit, onChange, onGone }: {
  p: FamilyAccessPerson;
  saved: StoredConfig;
  origin: string;
  fresh: string;
  onFresh: (url: string) => void;
  onEdit: () => void;
  onChange: (p: FamilyAccessPerson) => void;
  onGone: () => void;
}) {
  const screens = saved.screens;
  const [screenId, setScreenId] = useState(screens[0]?.id ?? '');
  const [busy, setBusy] = useState('');
  const [code, setCode] = useState<{ code: string; expiresAt: string; delivered: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const member = p.memberId ? saved.family?.members.find((m) => m.id === p.memberId) : null;
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [code]);
  const left = code ? Math.max(0, Math.round((Date.parse(code.expiresAt) - now) / 1000)) : 0;

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy('');
    }
  };
  const showCode = () =>
    run('code', async () => {
      const r = await api.familyAccessCode(p.id, screenId);
      setCode(r);
      setNow(Date.now());
      if (!r.delivered) toast(t('Esa pantalla no está conectada ahora: el código saldrá si se conecta en los próximos 2 minutos.'), 'error');
    });
  const newLink = async () => {
    if (p.link.exists) {
      const ok = await confirmDialog({
        title: t('¿Crear un enlace nuevo?'),
        body: t('El enlace actual deja de funcionar. Los móviles que ya entraron siguen funcionando.'),
        confirm: t('Crear enlace nuevo'),
      });
      if (!ok) return;
    }
    await run('link', async () => {
      const r = await api.familyAccessLink(p.id);
      onChange(r.person);
      onFresh(`${origin}${r.link.path}`);
    });
  };
  const revoke = async (deviceId: string, name: string) => {
    const ok = await confirmDialog({ title: t('¿Quitar el acceso a {name}?', { name }), body: t('Ese móvil deja de funcionar al momento.'), confirm: t('Quitar acceso'), danger: true });
    if (!ok) return;
    await run(`dev:${deviceId}`, async () => {
      await api.familyAccessRevokeDevice(p.id, deviceId);
      onChange({ ...p, devices: p.devices.filter((d) => d.id !== deviceId) });
    });
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: t('¿Quitar a {name}?', { name: p.name }),
      body: t('Su enlace, sus móviles y cualquier código dejan de funcionar al momento.'),
      confirm: t('Quitar persona'),
      danger: true,
    });
    if (!ok) return;
    await run('delete', async () => {
      await api.familyAccessDelete(p.id);
      onGone();
      toast(t('Acceso quitado'));
    });
  };

  return (
    <li class="fa-person">
      <div class="fa-person__head">
        <span class="fa-person__avatar" aria-hidden="true">
          {member?.avatar || '🙂'}
        </span>
        <div class="fa-person__main">
          <div class="fa-person__name">{p.name}</div>
          <div class="muted small">{permSummary(p.perms)}</div>
          <div class="muted small">{p.lastUsedAt ? t('Usado {when}', { when: relTime(p.lastUsedAt) }) : t('Sin usar todavía')}</div>
        </div>
        <Button size="sm" variant="ghost" icon="edit" onClick={onEdit}>
          {t('Editar')}
        </Button>
      </div>

      {fresh && (
        <div class="plink fa-fresh">
          <div class="plink__qr">
            <Qr text={fresh} label={t('Código QR del enlace de {name}', { name: p.name })} />
          </div>
          <div class="plink__main">
            <Field label={t('Enlace privado de {name}', { name: p.name })}>
              <CopyField value={fresh} />
            </Field>
            <Callout kind="warn">{t('Cópialo ahora: por seguridad solo se muestra esta vez. Si lo pierdes, crea uno nuevo.')}</Callout>
            <div class="plink__actions">
              <Button size="sm" variant="ghost" icon="x" onClick={() => onFresh('')}>
                {t('Hecho')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div class="fa-person__actions">
        {screens.length > 0 && (
          <div class="fa-code">
            <Select value={screenId} options={screens.map((s) => ({ value: s.id, label: s.name }))} onChange={setScreenId} />
            <Button size="sm" icon="monitor" loading={busy === 'code'} onClick={() => void showCode()}>
              {t('Mostrar un código')}
            </Button>
          </div>
        )}
        <Button size="sm" variant="ghost" icon="link" loading={busy === 'link'} onClick={() => void newLink()}>
          {p.link.exists ? t('Crear un enlace nuevo') : t('Crear enlace')}
        </Button>
        <Button size="sm" variant="ghost" icon="trash" loading={busy === 'delete'} onClick={() => void remove()}>
          {t('Quitar persona')}
        </Button>
      </div>
      {code && left > 0 && (
        <p class="fa-code-live">
          <b class="fa-code-live__code">{code.code}</b>{' '}
          <span class="muted small">{t('En la pantalla durante {s} s. Que lo escriba en {url}', { s: left, url: `${origin.replace(/^https?:\/\//, '')}/my` })}</span>
        </p>
      )}
      {p.link.exists && p.link.createdAt && <p class="muted small">{t('Enlace creado {when}', { when: relTime(p.link.createdAt) })}</p>}

      {p.devices.length > 0 && (
        <ul class="fa-devices">
          {p.devices.map((d) => (
            <li>
              <Icon name="user" size={15} />
              <span class="fa-devices__name">{d.name}</span>
              <span class="muted small">
                {d.via === 'code' ? t('con un código') : t('con el enlace')} · {d.lastSeenAt ? t('visto {when}', { when: relTime(d.lastSeenAt) }) : relTime(d.createdAt)}
              </span>
              <Button size="sm" variant="ghost" icon="x" loading={busy === `dev:${d.id}`} onClick={() => void revoke(d.id, d.name)}>
                {t('Quitar acceso')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function PersonDialog({ person, saved, onClose, onSaved }: {
  person: FamilyAccessPerson | null;
  saved: StoredConfig;
  onClose: () => void;
  onSaved: (p: FamilyAccessPerson, linkPath: string | null) => void;
}) {
  const start = person?.perms ?? { message: false, messageScreens: [], privacy: false, night: false, todo: false, events: false };
  const [name, setName] = useState(person?.name ?? '');
  const [memberId, setMemberId] = useState(person?.memberId ?? '');
  const [perms, setPerms] = useState<FamilyAccessPerms>({ ...start, messageScreens: [...start.messageScreens] });
  const [busy, setBusy] = useState(false);
  const members = saved.family?.members ?? [];
  const screens = saved.screens;
  const dirty = name !== (person?.name ?? '') || memberId !== (person?.memberId ?? '') || JSON.stringify(perms) !== JSON.stringify(start);

  const pickMember = (id: string) => {
    setMemberId(id);
    const m = members.find((x) => x.id === id);
    if (m && !name.trim()) setName(m.name.slice(0, NAME_MAX));
  };
  const toggleScreen = (id: string) =>
    setPerms((p) => ({ ...p, messageScreens: p.messageScreens.includes(id) ? p.messageScreens.filter((x) => x !== id) : [...p.messageScreens, id] }));

  const save = async () => {
    if (!name.trim()) return toast(t('Escribe un nombre.'), 'error');
    setBusy(true);
    try {
      const body = { name: name.trim(), memberId: memberId || null, perms };
      if (person) onSaved((await api.familyAccessUpdate(person.id, body)).person, null);
      else {
        const r = await api.familyAccessCreate(body);
        onSaved(r.person, r.link.path);
      }
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={person ? t('Editar acceso de {name}', { name: person.name }) : t('Añadir persona')}
      icon="users"
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {person ? t('Guardar') : t('Añadir y crear su enlace')}
          </Button>
        </>
      }
    >
      <Field label={t('Nombre')}>
        <TextInput value={name} maxLength={NAME_MAX} onValue={setName} placeholder={t('Por ejemplo: Ana')} />
      </Field>
      {members.length > 0 && (
        <Field label={t('Es de la familia')} hint={t('Su móvil usa su avatar y su color.')}>
          <Select value={memberId} options={[{ value: '', label: t('(ninguno)') }, ...members.map((m) => ({ value: m.id, label: `${m.avatar || '🙂'} ${m.name}` }))]} onChange={pickMember} />
        </Field>
      )}
      <div class="fa-perms">
        <div class="field__label">{t('Qué puede hacer')}</div>
        {PERMS.map((x) => (
          <div>
            <ToggleRow icon={x.emoji} label={t(x.label)} hint={t(x.hint)} checked={perms[x.key]} onChange={(v) => setPerms((p) => ({ ...p, [x.key]: v }))} />
            {x.key === 'message' && perms.message && screens.length > 1 && (
              <div class="fa-screens" role="group" aria-label={t('Pantallas')}>
                <button type="button" class={`fa-chip ${perms.messageScreens.length === 0 ? 'is-on' : ''}`} aria-pressed={perms.messageScreens.length === 0} onClick={() => setPerms((p) => ({ ...p, messageScreens: [] }))}>
                  {t('Todas las pantallas')}
                </button>
                {screens.map((s) => (
                  <button type="button" class={`fa-chip ${perms.messageScreens.includes(s.id) ? 'is-on' : ''}`} aria-pressed={perms.messageScreens.includes(s.id)} onClick={() => toggleScreen(s.id)}>
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
