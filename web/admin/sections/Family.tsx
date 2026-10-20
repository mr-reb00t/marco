// Familia: members, routines with stars, rewards and the family link (server/core/familyCore.js, server/family.js,
// docs/ARCHITECTURE.md "Familia"). Members, routines and rewards are config (saved with the save bar). What was done, the
// stars and the family link are live state (GET /api/admin/family) and change at once.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { choresForDay, KIDS_PRESETS, MAX_CHORES, MAX_MEMBERS, MAX_REWARDS, PASTELS } from '../../../server/core/familyCore.js';
import type { AppConfig, ChoreSlot, FamilyAdminState, FamilyChore, FamilyMember, StoredConfig } from '../../shared/types';
import { api, ApiError } from '../api';
import { isLocalhost, shareOrigin } from '../components/DisplayAccess';
import { choiceDialog, confirmDialog, toast } from '../components/feedback';
import { AvatarFace, MemberAvatarPicker } from '../components/AvatarPhoto';
import { FamilyAccessCard } from '../components/FamilyAccess';
import { has } from '../caps';
import { Icon, type IconName } from '../components/icons';
import { CopyField, Qr } from '../components/share';
import { Button, Callout, Card, ColorPicker, EmojiPicker, Empty, Field, Modal, NumberInput, PageHeader, ReorderButtons, Segmented, Select, TextInput, Toggle, ToggleRow, WeekdayPicker } from '../components/ui';
import { fmtDateTime, weekdayNames } from '../dates';
import { relTime, t } from '../i18n';
import { setPreviewFamilyQr } from '../livePreview';
import { allSourceOptions, moveItem, uid } from '../util';
import type { SectionProps } from './common';

type Tab = 'members' | 'routines' | 'rewards' | 'access';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'members', label: 'Miembros', icon: 'users' },
  { id: 'routines', label: 'Rutinas', icon: 'checklist' },
  { id: 'rewards', label: 'Premios', icon: 'star' },
  { id: 'access', label: 'Acceso', icon: 'link' },
];

/** Tab named by the route anchor: #/family/fam-routines (or #/family/routines). */
function tabFromHash(): Tab | null {
  const a = (location.hash.replace(/^#\/?/, '').split('/')[1] || '').replace(/^fam-/, '');
  if (a === 'screen' || a === 'people') return 'access';
  return TABS.some((x) => x.id === a) ? (a as Tab) : null;
}

export const SLOTS: { id: ChoreSlot; label: string; emoji: string }[] = [
  // "Por la …": 'Mañana' alone is already "tomorrow" in the dictionaries
  { id: 'morning', label: 'Por la mañana', emoji: '☀️' },
  { id: 'afternoon', label: 'Por la tarde', emoji: '🌤️' },
  { id: 'evening', label: 'Por la noche', emoji: '🌙' },
  { id: 'any', label: 'Cualquier momento', emoji: '✨' },
];

/** "Añadir rutinas de ejemplo" (titles are stored in the admin's language). */
const EXAMPLE_CHORES: { title: string; emoji: string; slot: ChoreSlot; days: number[] }[] = [
  { title: 'Lavarse los dientes', emoji: '🪥', slot: 'morning', days: [] },
  { title: 'Hacer la cama', emoji: '🛏️', slot: 'morning', days: [] },
  { title: 'Deberes', emoji: '📚', slot: 'afternoon', days: [1, 2, 3, 4, 5] },
  { title: 'Recoger los juguetes', emoji: '🧸', slot: 'evening', days: [] },
  { title: 'Poner la mesa', emoji: '🍽️', slot: 'evening', days: [] },
  { title: 'Lavarse los dientes', emoji: '🪥', slot: 'evening', days: [] },
];

const EXAMPLE_REWARDS = [
  { title: 'Elegir la peli del viernes', emoji: '🎬', cost: 10 },
  { title: 'Helado', emoji: '🍦', cost: 15 },
  { title: '30 min más de tablet', emoji: '📱', cost: 20 },
];

/** Readable text of a family API error. */
function errorText(e: unknown): string {
  const err = e as ApiError;
  const code = (err?.body as { code?: string } | null)?.code ?? err?.message;
  const map: Record<string, string> = {
    unknown_chore: 'Guarda los cambios antes de marcar esta rutina.',
    unknown_member: 'Guarda los cambios antes de usar esta persona.',
    unknown_reward: 'Guarda los cambios antes de canjear este premio.',
    not_today: 'Esta rutina no toca ese día.',
    not_kid: 'Solo los niños ganan estrellas.',
    not_enough: 'No tiene estrellas suficientes.',
    bad_delta: 'Escribe un número distinto de 0, entre -500 y 500.',
    bad_date: 'Solo se pueden marcar hoy y los 7 días anteriores.',
    not_found: 'Ya no existe.',
    network: 'Sin conexión con el servidor.',
  };
  return t(map[code ?? ''] ?? err?.message ?? 'Error');
}

/** Admin family state (stars, what was done, the link), loaded on open and after each save. */
function useFamilyState(revision: number) {
  const [st, setSt] = useState<FamilyAdminState | null>(null);
  const [err, setErr] = useState('');
  const reload = () =>
    api
      .family()
      .then((s) => {
        setSt(s);
        setErr('');
      })
      .catch((e) => setErr(errorText(e)));
  useEffect(() => {
    void reload();
  }, [revision]);
  // the preview of unsaved settings draws the same QR as the screens
  useEffect(() => {
    const origin = shareOrigin(st);
    setPreviewFamilyQr(st?.link.exists && st.link.path && origin ? `${origin}${st.link.path}` : null);
  }, [st?.link.path]);
  /** Run an action that answers { state }; false when it failed (the toast says why). */
  const run = async (p: Promise<{ state: FamilyAdminState }>, ok?: string) => {
    try {
      const r = await p;
      setSt(r.state);
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast(errorText(e), 'error');
      return false;
    }
  };
  return { st, setSt, err, reload, run };
}
type FamilyStateApi = ReturnType<typeof useFamilyState>;

/** Round avatar with the member's colour ring. */
export function Avatar({ m, size = 34 }: { m: Pick<FamilyMember, 'avatar' | 'color' | 'photo'>; size?: number }) {
  return (
    <span class="fam-avatar" style={{ '--mc': m.color, width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.55)}px` } as any} aria-hidden="true">
      <AvatarFace m={m} />
    </span>
  );
}

export function FamilySection(props: SectionProps) {
  const { full, setFull, cfg, go } = props;
  const f = full.family;
  const [tab, setTabRaw] = useState<Tab>(() => tabFromHash() ?? 'members');
  const fam = useFamilyState(props.saved.revision);
  useEffect(() => {
    const on = () => {
      const x = tabFromHash();
      if (x) setTabRaw(x);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const setTab = (x: Tab) => {
    setTabRaw(x);
    history.replaceState(null, '', `${location.pathname}${location.search}#/family/fam-${x}`);
  };
  const kidsLayout = (KIDS_PRESETS as readonly string[]).includes(cfg.layout.preset);

  return (
    <>
      <PageHeader title={t('Familia')} desc={t('Rutinas con estrellas para los niños, premios y el menú de la semana, en los diseños para niños de la pantalla.')} />
      <Card id="fam-on" scope="global">
        <ToggleRow
          label={t('Mostrar la familia en las pantallas')}
          hint={t('Cada niño ve sus rutinas de hoy y las marca desde el móvil o tocando la pantalla. Al terminarlas gana estrellas que puede cambiar por premios.')}
          checked={f.enabled}
          onChange={(v) => setFull((d) => void (d.family.enabled = v))}
        />
        {f.enabled && !kidsLayout && (
          <Callout>
            {t('Para verlo en {name}, elige el estilo Niños en Diseño.', { name: cfg.screen.name })}{' '}
            <button type="button" class="link-btn" onClick={() => go('layout/layout-kids')}>
              {t('Ver diseños para niños')}
            </button>
          </Callout>
        )}
      </Card>
      <div class="fam-tabs">
        <Segmented full value={tab} options={TABS.map((x) => ({ value: x.id, label: t(x.label), icon: x.icon }))} onChange={setTab} />
      </div>
      {tab === 'members' && <MembersTab {...props} />}
      {tab === 'routines' && <RoutinesTab {...props} fam={fam} />}
      {tab === 'rewards' && <RewardsTab {...props} fam={fam} />}
      {tab === 'access' && <AccessTab {...props} fam={fam} />}
    </>
  );
}

/* ------------------------------------------------------------------ Miembros */

function MembersTab({ full, setFull, errors }: SectionProps) {
  const f = full.family;
  const sources = allSourceOptions(full, { includeDisabled: true });
  const calOptions = [{ value: '', label: t('Ninguno') }, ...sources.map((o) => ({ value: o.id, label: `${o.emoji ? `${o.emoji} ` : ''}${o.name}` }))];
  const atMax = f.members.length >= MAX_MEMBERS;
  const upd = (id: string, fn: (m: FamilyMember) => void) =>
    setFull((d) => {
      const m = d.family.members.find((x) => x.id === id);
      if (m) fn(m);
    });
  const add = () =>
    setFull((d) => {
      const used = new Set(d.family.members.map((m) => m.color));
      const color = PASTELS.find((c) => !used.has(c)) ?? PASTELS[d.family.members.length % PASTELS.length];
      d.family.members.push({ id: uid('m'), name: '', color, avatar: '🙂', kid: true, calendarId: null });
    });
  const remove = async (m: FamilyMember) => {
    const n = f.chores.filter((h) => h.memberId === m.id).length;
    const ok = await confirmDialog({
      title: t('¿Quitar a {name}?', { name: m.name || t('esta persona') }),
      body: n ? t('También se borran sus rutinas ({n}).', { n }) : undefined,
      confirm: t('Quitar'),
      danger: true,
    });
    if (!ok) return;
    setFull((d) => {
      d.family.members = d.family.members.filter((x) => x.id !== m.id);
      d.family.chores = d.family.chores.filter((h) => h.memberId !== m.id);
      for (const s of d.screens) if (s.family?.memberIds) s.family.memberIds = s.family.memberIds.filter((x) => x !== m.id);
    });
  };

  return (
    <Card
      id="fam-members"
      scope="global"
      title={t('Miembros')}
      icon="users"
      desc={t('Hasta 6 personas. Los niños ganan estrellas con sus rutinas; los adultos pueden tener rutinas sin estrellas.')}
      actions={
        <Button size="sm" variant="primary" icon="plus" disabled={atMax} onClick={add}>
          {t('Añadir miembro')}
        </Button>
      }
    >
      {f.members.length === 0 ? (
        <Empty icon="users" title={t('Todavía no hay nadie')}>
          {t('Añade a cada persona de la casa con su nombre, un emoji o una foto y un color.')}
        </Empty>
      ) : (
        <ul class="fam-members">
          {f.members.map((m, i) => {
            const nameErr = errors[`fam.m.${m.id}.name`];
            return (
              <li class="fam-member" key={m.id} style={{ '--mc': m.color } as any}>
                <div class="fam-member__avatar">
                  <MemberAvatarPicker m={m} onChange={(patch) => upd(m.id, (x) => void Object.assign(x, patch))} />
                </div>
                <div class="fam-member__main">
                  <div class="fam-member__row">
                    <TextInput
                      class="fam-member__name"
                      value={m.name}
                      maxLength={30}
                      placeholder={t('Nombre')}
                      error={!!nameErr}
                      aria-label={t('Nombre')}
                      onValue={(v) => upd(m.id, (x) => void (x.name = v))}
                    />
                    <ReorderButtons index={i} count={f.members.length} onMove={(a, b) => setFull((d) => void (d.family.members = moveItem(d.family.members, a, b)))} />
                    <button type="button" class="icon-btn icon-btn--danger" aria-label={t('Quitar')} title={t('Quitar')} onClick={() => void remove(m)}>
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                  {nameErr && <span class="field__error">{t(nameErr)}</span>}
                  <div class="fam-swatches" role="group" aria-label={t('Color')}>
                    {PASTELS.map((c) => (
                      <button
                        type="button"
                        class={`swatch swatch--lg ${m.color === c ? 'is-active' : ''}`}
                        style={{ background: c }}
                        aria-label={c}
                        aria-pressed={m.color === c}
                        onClick={() => upd(m.id, (x) => void (x.color = c))}
                      />
                    ))}
                    <ColorPicker compact value={PASTELS.includes(m.color) ? null : m.color} onChange={(v) => v && upd(m.id, (x) => void (x.color = v.toLowerCase()))} error={!!errors[`fam.m.${m.id}.color`]} />
                  </div>
                  <div class="fam-member__opts">
                    <label class="mini-toggle">
                      <Toggle size="sm" checked={m.kid} onChange={(v) => upd(m.id, (x) => void (x.kid = v))} />
                      <span>{t('Es un niño o niña (gana estrellas)')}</span>
                    </label>
                    <div class="fam-member__cal">
                      <span class="muted small">{t('Calendario')}</span>
                      <Select value={m.calendarId ?? ''} options={calOptions} onChange={(v) => upd(m.id, (x) => void (x.calendarId = v || null))} />
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {atMax ? (
        <p class="muted small">{t('Máximo 6 personas.')}</p>
      ) : (
        <p class="muted small">{t('El calendario es opcional: sus eventos llevan su foto o su emoji en el diseño Familia.')}</p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ Rutinas */

/** Done chores of a date in the admin state (`choreId|memberId`: a routine moved to someone else starts undone). */
const doneOn = (st: FamilyAdminState | null, date: string) =>
  new Set((st?.completions ?? []).filter((c) => c.date === date).map((c) => `${c.choreId}|${c.memberId}`));

function RoutinesTab({ full, setFull, saved, errors, fam }: SectionProps & { fam: FamilyStateApi }) {
  const f = full.family;
  const [only, setOnly] = useState('');
  const wd = weekdayNames('narrow');
  const shown = f.members.filter((m) => !only || m.id === only);
  const atMax = f.chores.length >= MAX_CHORES;
  const upd = (id: string, fn: (h: FamilyChore) => void) =>
    setFull((d) => {
      const h = d.family.chores.find((x) => x.id === id);
      if (h) fn(h);
    });
  const add = (memberId: string, x?: Partial<FamilyChore>) =>
    setFull((d) => {
      if (d.family.chores.length >= MAX_CHORES) return;
      d.family.chores.push({ id: uid('h'), memberId, title: '', emoji: '⭐', days: [], slot: 'any', points: 1, enabled: true, ...x });
    });
  const addExamples = (memberId: string) =>
    setFull((d) => {
      for (const e of EXAMPLE_CHORES) {
        if (d.family.chores.length >= MAX_CHORES) break;
        d.family.chores.push({ id: uid('h'), memberId, title: t(e.title), emoji: e.emoji, days: [...e.days], slot: e.slot, points: 1, enabled: true });
      }
    });
  const move = (id: string, dir: -1 | 1) =>
    setFull((d) => {
      const list = d.family.chores;
      const i = list.findIndex((x) => x.id === id);
      let j = i + dir;
      while (j >= 0 && j < list.length && list[j].memberId !== list[i].memberId) j += dir;
      if (i >= 0 && j >= 0 && j < list.length) d.family.chores = moveItem(list, i, j);
    });

  if (!f.members.length) {
    return (
      <Card id="fam-routines" title={t('Rutinas')} icon="checklist" scope="global">
        <Empty icon="users" title={t('Primero añade a la familia')}>
          {t('Las rutinas son de cada persona. Añade miembros en la pestaña Miembros.')}
        </Empty>
      </Card>
    );
  }

  return (
    <div id="fam-routines" class="fam-stack">
      {f.members.length > 1 && (
        <div class="fam-filter">
          <button type="button" class={`pill ${!only ? 'is-on' : ''}`} onClick={() => setOnly('')}>
            {t('Todos')}
          </button>
          {f.members.map((m) => (
            <button type="button" class={`pill ${only === m.id ? 'is-on' : ''}`} onClick={() => setOnly(m.id)}>
              <Avatar m={m} size={20} /> {m.name || t('Sin nombre')}
            </button>
          ))}
        </div>
      )}
      {atMax && <Callout kind="warn">{t('Has llegado al máximo de 80 rutinas.')}</Callout>}
      {shown.map((m) => {
        const mine = f.chores.filter((h) => h.memberId === m.id);
        const stars = f.showPoints && m.kid;
        return (
          <Card
            key={m.id}
            scope="global"
            class="fam-group"
            title={
              <span class="fam-group__title">
                <Avatar m={m} size={30} />
                {m.name || t('Sin nombre')}
              </span>
            }
            desc={mine.length ? t('{n} rutinas', { n: mine.length }) : undefined}
            actions={
              <Button size="sm" icon="plus" disabled={atMax} onClick={() => add(m.id)}>
                {t('Añadir rutina')}
              </Button>
            }
          >
            <TodayChecks member={m} saved={saved} fam={fam} />
            {mine.length === 0 ? (
              <div class="fam-empty-row">
                <span class="muted small">{t('Sin rutinas todavía.')}</span>
                <Button size="sm" variant="ghost" icon="wand" disabled={atMax} onClick={() => addExamples(m.id)}>
                  {t('Añadir rutinas de ejemplo')}
                </Button>
              </div>
            ) : (
              <ul class="fam-chores">
                {mine.map((h, k) => {
                  const titleErr = errors[`fam.h.${h.id}.title`];
                  return (
                    <li class={`fam-chore ${h.enabled ? '' : 'is-off'}`} key={h.id}>
                      <div class="fam-chore__top">
                        <EmojiPicker value={h.emoji} onChange={(v) => upd(h.id, (x) => void (x.emoji = v || '⭐'))} />
                        <TextInput
                          class="fam-chore__title"
                          value={h.title}
                          maxLength={60}
                          placeholder={t('Ej.: Lavarse los dientes')}
                          error={!!titleErr}
                          aria-label={t('Rutina')}
                          onValue={(v) => upd(h.id, (x) => void (x.title = v))}
                        />
                        <div class="fam-chore__slot">
                          <Select value={h.slot} options={SLOTS.map((s) => ({ value: s.id, label: `${s.emoji} ${t(s.label)}` }))} onChange={(v) => upd(h.id, (x) => void (x.slot = v))} />
                        </div>
                        {stars && (
                          <div class="fam-chore__pts" title={t('Estrellas')}>
                            <NumberInput value={h.points} min={0} max={20} suffix="⭐" error={!!errors[`fam.h.${h.id}.points`]} onValue={(v) => upd(h.id, (x) => void (x.points = v))} />
                          </div>
                        )}
                      </div>
                      <div class="fam-chore__bottom">
                        <button type="button" class={`pill pill--sm ${h.days.length ? '' : 'is-on'}`} onClick={() => upd(h.id, (x) => void (x.days = []))}>
                          {t('Todos los días')}
                        </button>
                        <WeekdayPicker labels={wd} value={h.days} onChange={(v) => upd(h.id, (x) => void (x.days = v.length === 7 ? [] : v))} />
                        <span class="fam-chore__spacer" />
                        <label class="mini-toggle" title={h.enabled ? t('Activa') : t('En pausa')}>
                          <Toggle size="sm" checked={h.enabled} onChange={(v) => upd(h.id, (x) => void (x.enabled = v))} />
                          <span class="hide-xs">{h.enabled ? t('Activa') : t('En pausa')}</span>
                        </label>
                        <div class="reorder">
                          <button type="button" class="icon-btn" disabled={k === 0} onClick={() => move(h.id, -1)} aria-label={t('Subir')} title={t('Subir')}>
                            <Icon name="up" size={14} />
                          </button>
                          <button type="button" class="icon-btn" disabled={k === mine.length - 1} onClick={() => move(h.id, 1)} aria-label={t('Bajar')} title={t('Bajar')}>
                            <Icon name="down" size={14} />
                          </button>
                        </div>
                        <button
                          type="button"
                          class="icon-btn icon-btn--danger"
                          aria-label={t('Eliminar')}
                          title={t('Eliminar')}
                          onClick={() => setFull((d) => void (d.family.chores = d.family.chores.filter((x) => x.id !== h.id)))}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                      {titleErr && <span class="field__error">{t(titleErr)}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/** Today's routines of one member (saved config, as the server sees them) with tick buttons. */
function TodayChecks({ member, saved, fam }: { member: FamilyMember; saved: StoredConfig; fam: FamilyStateApi }) {
  const { st, run } = fam;
  const [busy, setBusy] = useState('');
  if (!st) return null;
  const savedFam = saved.family;
  if (!savedFam?.members.some((m) => m.id === member.id)) {
    return <p class="muted small fam-today__note">{t('Guarda los cambios para marcar las rutinas de hoy.')}</p>;
  }
  const todays = choresForDay(savedFam, st.today, [member.id]);
  if (!todays.length) return <p class="muted small fam-today__note">{t('Hoy no le toca ninguna rutina.')}</p>;
  const done = doneOn(st, st.today);
  const n = todays.filter((h) => done.has(`${h.id}|${h.memberId}`)).length;
  return (
    <div class="fam-today">
      <div class="fam-today__head">
        <strong class="small">{t('Hoy')}</strong>
        <div class="fam-bar" style={{ '--mc': member.color, '--pct': `${Math.round((n / todays.length) * 100)}%` } as any}>
          <span />
        </div>
        <span class="small muted">
          {n}/{todays.length}
        </span>
      </div>
      <div class="fam-today__list">
        {todays.map((h) => {
          const on = done.has(`${h.id}|${h.memberId}`);
          return (
            <button
              type="button"
              class={`fam-check ${on ? 'is-done' : ''}`}
              style={{ '--mc': member.color } as any}
              aria-pressed={on}
              disabled={busy === h.id}
              onClick={async () => {
                setBusy(h.id);
                await run(api.familyToggle({ choreId: h.id, done: !on }));
                setBusy('');
              }}
            >
              <span class="fam-check__box">{on && <Icon name="check" size={12} />}</span>
              <span>
                {h.emoji} {h.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Premios */

function RewardsTab({ full, setFull, saved, errors, fam }: SectionProps & { fam: FamilyStateApi }) {
  const f = full.family;
  const atMax = f.rewards.length >= MAX_REWARDS;
  const upd = (id: string, fn: (w: (typeof f.rewards)[number]) => void) =>
    setFull((d) => {
      const w = d.family.rewards.find((x) => x.id === id);
      if (w) fn(w);
    });
  const add = (x?: { title: string; emoji: string; cost: number }) =>
    setFull((d) => {
      if (d.family.rewards.length < MAX_REWARDS) d.family.rewards.push({ id: uid('w'), title: x ? t(x.title) : '', emoji: x?.emoji ?? '🎁', cost: x?.cost ?? 10 });
    });
  const examples = EXAMPLE_REWARDS.filter((x) => !f.rewards.some((w) => w.title === t(x.title) || w.title === x.title));

  return (
    <div id="fam-rewards" class="fam-stack">
      <Card scope="global" title={t('Estrellas')} icon="star" desc={t('Cada rutina hecha suma sus estrellas al niño o niña.')}>
        <ToggleRow label={t('Mostrar estrellas')} hint={t('En las pantallas y en el móvil. Sin estrellas, las rutinas siguen funcionando.')} checked={f.showPoints} onChange={(v) => setFull((d) => void (d.family.showPoints = v))} />
        <ToggleRow
          label={t('Permitir canjear premios desde el móvil')}
          hint={t('Si está apagado, los premios se canjean aquí, en el panel. En la pantalla nunca se canjean.')}
          checked={f.allowRedeemFromPhone}
          onChange={(v) => setFull((d) => void (d.family.allowRedeemFromPhone = v))}
        />
      </Card>
      <Card
        scope="global"
        title={t('Premios')}
        icon="star"
        desc={t('Lo que se puede conseguir con estrellas. Hasta 20 premios.')}
        actions={
          <Button size="sm" variant="primary" icon="plus" disabled={atMax} onClick={() => add()}>
            {t('Añadir premio')}
          </Button>
        }
      >
        {f.rewards.length === 0 && (
          <Empty icon="star" title={t('Sin premios')}>
            {t('Añade alguno o usa los ejemplos de abajo.')}
          </Empty>
        )}
        {f.rewards.length > 0 && (
          <ul class="fam-rewards">
            {f.rewards.map((w) => (
              <li class="fam-reward" key={w.id}>
                <EmojiPicker value={w.emoji} onChange={(v) => upd(w.id, (x) => void (x.emoji = v || '🎁'))} />
                <TextInput class="fam-reward__title" value={w.title} maxLength={60} placeholder={t('Ej.: Elegir la cena del sábado')} error={!!errors[`fam.w.${w.id}.title`]} aria-label={t('Premio')} onValue={(v) => upd(w.id, (x) => void (x.title = v))} />
                <div class="fam-reward__cost" title={t('Cuesta')}>
                  <NumberInput value={w.cost} min={1} max={500} suffix="⭐" error={!!errors[`fam.w.${w.id}.cost`]} onValue={(v) => upd(w.id, (x) => void (x.cost = v))} />
                </div>
                <button type="button" class="icon-btn icon-btn--danger" aria-label={t('Eliminar')} title={t('Eliminar')} onClick={() => setFull((d) => void (d.family.rewards = d.family.rewards.filter((x) => x.id !== w.id)))}>
                  <Icon name="trash" size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {examples.length > 0 && !atMax && (
          <div class="quick-add">
            <span class="muted small">{t('Añadir rápido:')}</span>
            {examples.map((x) => (
              <button type="button" class="pill" onClick={() => add(x)}>
                {x.emoji} {t(x.title)} · {x.cost} ⭐
              </button>
            ))}
          </div>
        )}
      </Card>
      <StarsCard saved={saved} fam={fam} />
      <HistoryCard saved={saved} fam={fam} />
    </div>
  );
}

/** Balance of each saved kid, +1 / −1 / adjust / redeem (live, no save needed). */
function StarsCard({ saved, fam }: { saved: StoredConfig; fam: FamilyStateApi }) {
  const { st, run, err } = fam;
  const [adjust, setAdjust] = useState<FamilyMember | null>(null);
  const [busy, setBusy] = useState('');
  const kids = (saved.family?.members ?? []).filter((m) => m.kid);
  const rewards = saved.family?.rewards ?? [];
  const act = async (key: string, p: () => Promise<{ state: FamilyAdminState }>, ok?: string) => {
    setBusy(key);
    await run(p(), ok);
    setBusy('');
  };
  const redeem = async (m: FamilyMember) => {
    if (!rewards.length) return toast(t('Añade premios y guarda primero.'), 'error');
    const rid = await choiceDialog({
      title: t('¿Qué premio canjea {name}?', { name: m.name }),
      closeX: true,
      choices: rewards.map((w) => ({ value: w.id, label: `${w.emoji} ${w.title} · ${w.cost} ⭐`, kind: 'default' as const })),
    });
    if (!rid) return;
    const w = rewards.find((x) => x.id === rid)!;
    setBusy(`r-${m.id}`);
    try {
      const r = await api.familyRedeem({ rewardId: rid, memberId: m.id });
      fam.setSt(r.state);
      toast(t('Canjeado: {reward}', { reward: w.title }));
    } catch (e) {
      if ((e as ApiError).status === 409) {
        const have = Math.max(0, st?.points[m.id] ?? 0);
        const ok = await confirmDialog({
          title: t('No tiene estrellas suficientes'),
          body: t('{name} tiene {have} ⭐ y el premio cuesta {cost} ⭐. ¿Canjearlo igualmente?', { name: m.name, have, cost: w.cost }),
          confirm: t('Canjear igualmente'),
        });
        if (ok) await run(api.familyRedeem({ rewardId: rid, memberId: m.id, force: true }), t('Canjeado: {reward}', { reward: w.title }));
      } else toast(errorText(e), 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <Card id="fam-stars" scope="global" title={t('Estrellas de cada niño')} icon="star" desc={t('Los cambios de aquí se aplican al momento, sin guardar.')}>
      {err && !st ? (
        <Callout kind="error">{err}</Callout>
      ) : !st ? (
        <div class="skeleton skeleton--card" />
      ) : kids.length === 0 ? (
        <p class="muted small">{t('Aquí verás las estrellas de los niños cuando los añadas y guardes.')}</p>
      ) : (
        <ul class="fam-balances">
          {kids.map((m) => (
            <li class="fam-balance" key={m.id}>
              <Avatar m={m} size={36} />
              <div class="fam-balance__who">
                <strong>{m.name}</strong>
                <span class="fam-stars">⭐ {Math.max(0, st.points[m.id] ?? 0)}</span>
              </div>
              <div class="fam-balance__actions">
                <Button size="sm" loading={busy === `p-${m.id}`} onClick={() => act(`p-${m.id}`, () => api.familyAdjust({ memberId: m.id, delta: 1 }))}>
                  +1
                </Button>
                <Button size="sm" loading={busy === `m-${m.id}`} onClick={() => act(`m-${m.id}`, () => api.familyAdjust({ memberId: m.id, delta: -1 }))}>
                  −1
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAdjust(m)}>
                  {t('Ajustar…')}
                </Button>
                <Button size="sm" variant="primary" icon="star" loading={busy === `r-${m.id}`} onClick={() => void redeem(m)}>
                  {t('Canjear')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adjust && <AdjustDialog member={adjust} onClose={() => setAdjust(null)} onDone={(s) => fam.setSt(s)} />}
    </Card>
  );
}

function AdjustDialog({ member, onClose, onDone }: { member: FamilyMember; onClose: () => void; onDone: (s: FamilyAdminState) => void }) {
  const [delta, setDelta] = useState(5);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = Number.isInteger(delta) && delta !== 0 && Math.abs(delta) <= 500;
  const submit = async (e?: Event) => {
    e?.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const r = await api.familyAdjust({ memberId: member.id, delta, note: note.trim() || undefined });
      onDone(r.state);
      toast(t('Estrellas ajustadas'));
      onClose();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Ajustar las estrellas de {name}', { name: member.name })}
      icon="star"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            {t('Guardar')}
          </Button>
        </>
      }
    >
      <form class="fam-adjust" onSubmit={submit}>
        <Field label={t('Estrellas')} hint={t('En negativo para quitar, por ejemplo -3.')}>
          <NumberInput value={delta} min={-500} max={500} suffix="⭐" error={!valid} onValue={setDelta} />
        </Field>
        <Field label={t('Motivo (opcional)')}>
          <TextInput value={note} onValue={setNote} maxLength={80} placeholder={t('Ej.: Ayudó a recoger la cocina')} />
        </Field>
      </form>
    </Modal>
  );
}

/** Last routines, redemptions and adjustments, newest first, with undo on the last two. */
function HistoryCard({ saved, fam }: { saved: StoredConfig; fam: FamilyStateApi }) {
  const { st, run } = fam;
  const [busy, setBusy] = useState('');
  const members = new Map((saved.family?.members ?? []).map((m) => [m.id, m]));
  const rows = useMemo(() => {
    if (!st) return [];
    type Row = { key: string; at: string; memberId: string; text: string; delta: number | null; undo?: { kind: 'redemption' | 'adjustment'; id: string } };
    const out: Row[] = [];
    for (const c of st.completions)
      out.push({ key: `c-${c.date}-${c.choreId}`, at: c.at, memberId: c.memberId, text: `${c.emoji} ${c.title}`, delta: members.get(c.memberId)?.kid && c.points ? c.points : null });
    for (const r of st.redemptions)
      out.push({ key: `r-${r.id}`, at: r.at, memberId: r.memberId, text: `${t('Premio')}: ${r.emoji} ${r.title}`, delta: -r.cost, undo: { kind: 'redemption', id: r.id } });
    for (const a of st.adjustments)
      out.push({ key: `a-${a.id}`, at: a.at, memberId: a.memberId, text: a.note ? `${t('Ajuste')}: ${a.note}` : t('Ajuste a mano'), delta: a.delta, undo: { kind: 'adjustment', id: a.id } });
    return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 40);
  }, [st, saved]);
  if (!st) return null;
  return (
    <Card id="fam-history" scope="global" title={t('Historial')} icon="history" desc={t('Rutinas de los últimos 14 días, premios canjeados y ajustes.')}>
      {rows.length === 0 ? (
        <p class="muted small">{t('Todavía no hay nada.')}</p>
      ) : (
        <ul class="fam-history">
          {rows.map((r) => {
            const m = members.get(r.memberId);
            return (
              <li key={r.key}>
                {m ? <Avatar m={m} size={24} /> : <span class="fam-avatar" style={{ width: '24px', height: '24px' }} />}
                <span class="fam-history__text">
                  <strong>{m?.name ?? t('Persona borrada')}</strong> {r.text}
                </span>
                {r.delta != null && <span class={`fam-history__delta ${r.delta < 0 ? 'is-neg' : ''}`}>{`${r.delta > 0 ? '+' : ''}${r.delta} ⭐`}</span>}
                <span class="muted small fam-history__when" title={fmtDateTime(r.at)}>
                  {relTime(r.at)}
                </span>
                {r.undo ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === r.key}
                    onClick={async () => {
                      setBusy(r.key);
                      await run(api.familyUndo(r.undo!.kind, r.undo!.id), t('Deshecho'));
                      setBusy('');
                    }}
                  >
                    {t('Deshacer')}
                  </Button>
                ) : (
                  <span class="fam-history__undo-space" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ Acceso */

function AccessTab(props: SectionProps & { fam: FamilyStateApi }) {
  const { full, setFull, saved, fam } = props;
  return (
    <div id="fam-access" class="fam-stack">
      {has('familyAccess') && <FamilyAccessCard saved={saved} />}
      <FamilyLinkCard saved={saved} fam={fam} />
      <Card id="fam-screen" scope="screen" title={t('En esta pantalla')} icon="monitor" desc={t('Quién sale, el código QR y si se puede marcar tocando la pantalla.')}>
        <FamilyScreenOptions cfg={props.cfg} set={props.set} />
        <TouchHelp />
      </Card>
      <Card id="fam-privacy" scope="global" title={t('En modo privado')} icon="lock" desc={t('Cuando una pantalla está en modo privado (por ejemplo con invitados).')}>
        <Segmented
          full
          value={full.family.privacy}
          options={[
            { value: 'initials', label: t('Mostrar solo iniciales') },
            { value: 'hide', label: t('Ocultar las rutinas') },
          ]}
          onChange={(v) => setFull((d) => void (d.family.privacy = v))}
        />
        <p class="muted small">
          {full.family.privacy === 'hide'
            ? t('Las rutinas no se ven. El menú de comidas sigue a la vista.')
            : t('Se ven las rutinas con la inicial de cada niño, sin estrellas, sin QR y sin poder marcar tocando.')}
        </p>
      </Card>
    </div>
  );
}

function FamilyLinkCard({ saved, fam }: { saved: StoredConfig; fam: FamilyStateApi }) {
  const { st, err, setSt } = fam;
  const [busy, setBusy] = useState('');
  const link = st?.link;
  const origin = shareOrigin(st);
  const url = link?.path ? `${origin || location.origin}${link.path}` : '';
  const create = async (again: boolean) => {
    if (again) {
      const ok = await confirmDialog({
        title: t('¿Crear un enlace nuevo?'),
        body: t('El enlace actual deja de funcionar al momento. Después abre el nuevo en cada móvil o escanea otra vez el QR.'),
        confirm: t('Crear enlace nuevo'),
        danger: true,
      });
      if (!ok) return;
    }
    setBusy('create');
    try {
      const r = await api.familyLink();
      if (st) setSt({ ...st, link: r.link });
      toast(again ? t('Enlace nuevo creado. El anterior ya no funciona.') : t('Enlace familiar creado'));
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy('');
    }
  };
  const revoke = async () => {
    const ok = await confirmDialog({
      title: t('¿Quitar el enlace familiar?'),
      body: t('Los móviles que lo usan dejan de ver las rutinas y el QR desaparece de las pantallas.'),
      confirm: t('Quitar enlace'),
      danger: true,
    });
    if (!ok) return;
    setBusy('revoke');
    try {
      await api.revokeFamilyLink();
      if (st) setSt({ ...st, link: { exists: false, path: null, createdAt: null } });
      toast(t('Enlace quitado'));
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <Card
      scope="global"
      title={t('Enlace familiar')}
      icon="link"
      desc={t('Un enlace para los móviles de casa. Con él se ven las rutinas de hoy, se marcan y se ven las estrellas. No da acceso al panel, ni a los calendarios ni a las fotos.')}
    >
      {!saved.family?.enabled && <Callout kind="warn">{t('Activa la familia y guarda para que el enlace funcione.')}</Callout>}
      {err && !st ? (
        <Callout kind="error">{err}</Callout>
      ) : !st ? (
        <div class="skeleton skeleton--card" />
      ) : !link?.exists ? (
        <div class="fam-link-empty">
          <p class="muted small">{t('Todavía no hay enlace. Al crearlo, las pantallas con un diseño para niños muestran su código QR.')}</p>
          <Button variant="primary" icon="link" loading={busy === 'create'} onClick={() => void create(false)}>
            {t('Crear enlace familiar')}
          </Button>
        </div>
      ) : (
        <div class="plink">
          {origin && (
            <div class="plink__qr">
              <Qr text={url} label={t('Código QR del enlace familiar')} />
              <span class="muted small">{t('Escanéalo con el móvil')}</span>
            </div>
          )}
          <div class="plink__main">
            <Field label={t('Enlace familiar')}>
              <CopyField value={url} />
            </Field>
            {isLocalhost() && origin && <p class="muted small">{t('Estás en «localhost»: el enlace usa la dirección de red de este ordenador ({host}) para que funcione en otros dispositivos.', { host: new URL(origin).host })}</p>}
            {isLocalhost() && !origin && (
              <Callout kind="warn">{t('Estás en «localhost» y no se conoce la dirección de red de este servidor: abre el panel con su IP o su nombre (o define LAN_ADDRESS) para obtener el QR.')}</Callout>
            )}
            <div class="plink__actions">
              <a class="btn btn--default btn--sm" href={link.path!} target="_blank" rel="noopener noreferrer">
                <Icon name="external" size={15} />
                <span>{t('Abrir')}</span>
              </a>
              <Button size="sm" variant="ghost" icon="refresh" loading={busy === 'create'} onClick={() => void create(true)}>
                {t('Crear un enlace nuevo')}
              </Button>
              <Button size="sm" variant="ghost" icon="trash" loading={busy === 'revoke'} onClick={() => void revoke()}>
                {t('Quitar enlace')}
              </Button>
              {link.createdAt && <span class="muted small">{t('Creado {when}', { when: relTime(link.createdAt) })}</span>}
            </div>
            <p class="muted small">{t('Cualquiera con el enlace puede marcar rutinas: compártelo solo con la familia. Si se pierde un móvil, crea un enlace nuevo.')}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

/** How touching the screen works (Acceso tab). */
function TouchHelp() {
  return (
    <div class="fam-help">
      <strong class="small">{t('Cómo funciona marcar tocando la pantalla')}</strong>
      <ul class="small muted">
        <li>{t('Sirve para tablets y monitores táctiles con los diseños Rutinas y Familia, del estilo Niños.')}</li>
        <li>{t('Cada niño toca su rutina para marcarla. Si se equivoca, la toca otra vez y se desmarca.')}</li>
        <li>{t('Los premios no se canjean en la pantalla, solo en el móvil (si lo permites) o aquí.')}</li>
        <li>{t('Mientras la pantalla está en modo privado no se puede marcar.')}</li>
        <li>{t('En modo abierto vale cualquier pantalla de tu red. En modo privado, la pantalla necesita su enlace privado o estar vinculada.')}</li>
      </ul>
    </div>
  );
}

/**
 * Per-screen family options (this screen): touch, QR and who appears. Used in Familia › Acceso and under the kids
 * layouts in Diseño.
 */
export function FamilyScreenOptions({ cfg, set, compact }: { cfg: AppConfig; set: SectionProps['set']; compact?: boolean }) {
  const f = cfg.family;
  const ids = f.memberIds;
  const pick = Array.isArray(ids);
  const toggle = (id: string, on: boolean) =>
    set((d) => {
      const cur = d.family.memberIds ?? [];
      const next = new Set(on ? [...cur, id] : cur.filter((x) => x !== id));
      d.family.memberIds = d.family.members.map((m) => m.id).filter((x) => next.has(x));
    });
  return (
    <>
      <ToggleRow
        label={t('Permitir marcar tocando esta pantalla')}
        hint={t('Necesita una pantalla táctil. No funciona mientras la pantalla está en modo privado.')}
        checked={f.touch}
        onChange={(v) => set((d) => void (d.family.touch = v))}
      />
      <ToggleRow
        label={t('Mostrar el código QR en la pantalla')}
        hint={t('Para abrir el enlace familiar con el móvil. Solo sale si has creado el enlace.')}
        checked={f.showQr}
        onChange={(v) => set((d) => void (d.family.showQr = v))}
      />
      {!compact && f.members.length > 0 && (
        <Field label={t('Quién sale en esta pantalla')}>
          <Segmented
            full
            value={pick ? 'pick' : 'all'}
            options={[
              { value: 'all', label: t('Todos') },
              { value: 'pick', label: t('Elegir') },
            ]}
            onChange={(v) => set((d) => void (d.family.memberIds = v === 'all' ? null : d.family.members.map((m) => m.id)))}
          />
          {pick && (
            <ul class="gcal-list screen-src-list fam-who">
              {f.members.map((m) => {
                const on = ids!.includes(m.id);
                return (
                  <li key={m.id}>
                    <label class={`gcal ${on ? 'is-on' : ''}`}>
                      <input type="checkbox" checked={on} onChange={(e) => toggle(m.id, e.currentTarget.checked)} />
                      <span class="check-box">
                        <Icon name="check" size={12} />
                      </span>
                      <Avatar m={m} size={22} />
                      <span class="gcal__name">{m.name || t('Sin nombre')}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {pick && ids!.length === 0 && <Callout kind="warn">{t('No has elegido a nadie: esta pantalla no mostrará rutinas.')}</Callout>}
        </Field>
      )}
    </>
  );
}
