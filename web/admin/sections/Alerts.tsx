import { useEffect, useState } from 'preact/hooks';
import type { AlertStyle, Announcement, AnnouncementsResponse, ScheduledMessage } from '../../shared/types';
import { api, ApiError } from '../api';
import { ALERT_STYLES, AlertCardPreview, AnnounceForm, ScreenTargets, StylePicker } from '../components/AnnounceForm';
import { confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { Button, Card, EmojiPicker, Empty, Field, Modal, PageHeader, Slider, Textarea, TextInput, Toggle, ToggleRow, WeekdayPicker } from '../components/ui';
import { addDays, fmtDateTime, fmtDay, todayIn, weekdayNames, weekdayOf } from '../dates';
import { relTime, t } from '../i18n';
import { has } from '../caps';
import { takeIntent } from '../intent';
import { clone, TIME_RE, uid } from '../util';
import { withPollNote } from '../liveNote';
import type { SectionProps } from './common';

/* ---------------------------------------------------------------- schedule evaluation (docs/ARCHITECTURE.md) */


/** Who sent an announcement: the admin's email, a webhook token or a person from their phone dashboard. */
const announcementBy = (a: Announcement) =>
  a.via === 'hook' ? `⚡ ${a.by.replace(/^token:/, '')}` : a.via === 'family' ? `📱 ${a.by.replace(/^family:/, '')}` : a.by;

function nowParts(tz: string) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const [h, m] = f.format(new Date()).split(':').map(Number);
  return { today: todayIn(tz), n: h * 60 + m };
}
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

export function scheduleActive(m: ScheduledMessage, tz: string): boolean {
  if (!m.enabled || !TIME_RE.test(m.from) || !TIME_RE.test(m.to) || m.from === m.to) return false;
  const { today, n } = nowParts(tz);
  const ok = (day: string) => (!m.days.length || m.days.includes(weekdayOf(day))) && (!m.startDate || m.startDate <= day) && (!m.endDate || day <= m.endDate);
  const from = toMin(m.from);
  const to = toMin(m.to);
  if (from < to) return ok(today) && n >= from && n < to;
  return (ok(today) && n >= from) || (ok(addDays(today, -1)) && n < to);
}

/* ---------------------------------------------------------------- chime (preview of the display sound) */

let audioCtx: AudioContext | null = null;
export function playChime(style: AlertStyle, volume: number) {
  try {
    audioCtx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = audioCtx;
    const seq = style === 'warning' ? [660, 880, 660] : style === 'urgent' ? [880, 660, 880, 660, 880, 660] : style === 'success' ? [784, 1046] : [659, 988];
    let at = ctx.currentTime + 0.02;
    for (const f of seq) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.25 * volume, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
      o.connect(g).connect(ctx.destination);
      o.start(at);
      o.stop(at + 0.5);
      at += style === 'urgent' ? 0.18 : 0.22;
    }
  } catch {
    /* no audio */
  }
}

/* ---------------------------------------------------------------- active / history */

function Remaining({ a }: { a: Announcement }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const total = Date.parse(a.expiresAt) - Date.parse(a.createdAt);
  const left = Math.max(0, Date.parse(a.expiresAt) - Date.now());
  const pct = total > 0 ? (left / total) * 100 : 0;
  const s = Math.round(left / 1000);
  const label = s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
  return (
    <div class="remain">
      <div class="remain__bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      <span class="muted small">{t('quedan {t}', { t: label })}</span>
    </div>
  );
}

function screenNames(ids: string[], screens: { id: string; name: string }[]) {
  if (!ids.length) return t('Todas las pantallas');
  return ids.map((id) => screens.find((s) => s.id === id)?.name ?? id).join(', ');
}

/* ---------------------------------------------------------------- schedule editor */

function newSchedule(): ScheduledMessage {
  return { id: uid('m'), enabled: true, title: '', body: '', emoji: '🗑️', style: 'info', days: [2, 5], from: '20:00', to: '22:00', startDate: null, endDate: null, screenIds: [], sound: false };
}

function ScheduleEditor({ initial, isNew, screens, onSave, onClose, onDelete }: { initial: ScheduledMessage; isNew: boolean; screens: SectionProps['full']['screens']; onSave: (m: ScheduledMessage) => void; onClose: () => void; onDelete?: () => void }) {
  const [m, setM] = useState(() => clone(initial));
  const [tried, setTried] = useState(false);
  const wd = weekdayNames('short');
  const upd = (fn: (x: ScheduledMessage) => void) =>
    setM((x) => {
      const c = clone(x);
      fn(c);
      return c;
    });
  const e: Record<string, string> = {};
  if (!m.title.trim()) e.title = 'Obligatorio';
  if (!TIME_RE.test(m.from)) e.from = 'Hora no válida (HH:MM)';
  if (!TIME_RE.test(m.to)) e.to = 'Hora no válida (HH:MM)';
  else if (m.from === m.to) e.to = 'Debe ser distinta de la hora de inicio';
  if (m.startDate && m.endDate && m.endDate < m.startDate) e.endDate = 'Debe ser igual o posterior al inicio';
  const shown = tried ? e : {};
  const crosses = TIME_RE.test(m.from) && TIME_RE.test(m.to) && m.to < m.from;
  const submit = () => {
    setTried(true);
    if (Object.keys(e).length) return;
    onSave({ ...m, title: m.title.trim(), body: m.body.trim() });
  };
  return (
    <Modal
      title={isNew ? t('Nuevo mensaje programado') : t('Editar mensaje programado')}
      icon="clock"
      onClose={onClose}
      dirty={JSON.stringify(m) !== JSON.stringify(initial)}
      footer={
        <>
          {onDelete && (
            <Button variant="ghost" icon="trash" class="btn--danger-text" onClick={onDelete}>
              {t('Eliminar')}
            </Button>
          )}
          <span class="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" icon="check" onClick={submit}>
            {isNew ? t('Añadir') : t('Aplicar')}
          </Button>
        </>
      }
    >
      <div class="stack">
        <div class="ev-editor__title">
          <EmojiPicker size="lg" value={m.emoji} allowNone onChange={(v) => upd((x) => void (x.emoji = v))} />
          <TextInput class="input--lg" value={m.title} maxLength={80} error={!!shown.title} placeholder={t('Ej.: Sacar la basura')} onValue={(v) => upd((x) => void (x.title = v))} />
        </div>
        <Field label={t('Texto (opcional)')}>
          <Textarea rows={2} maxLength={300} value={m.body} placeholder={t('Orgánico y envases 🟡')} onValue={(v) => upd((x) => void (x.body = v))} />
        </Field>
        <Field label={t('Días')} hint={m.days.length ? undefined : t('Ninguno marcado: todos los días')}>
          <WeekdayPicker labels={wd} value={m.days} onChange={(v) => upd((x) => void (x.days = v))} />
        </Field>
        <div class="grid grid--2">
          <Field label={t('Desde')} error={shown.from}>
            <input class={`input ${shown.from ? 'is-invalid' : ''}`} type="time" value={m.from} onInput={(ev) => upd((x) => void (x.from = ev.currentTarget.value))} />
          </Field>
          <Field label={t('Hasta')} error={shown.to} hint={crosses ? t('Termina al día siguiente') : undefined}>
            <input class={`input ${shown.to ? 'is-invalid' : ''}`} type="time" value={m.to} onInput={(ev) => upd((x) => void (x.to = ev.currentTarget.value))} />
          </Field>
          <Field label={t('Primer día (opcional)')}>
            <input class="input" type="date" value={m.startDate ?? ''} onInput={(ev) => upd((x) => void (x.startDate = ev.currentTarget.value || null))} />
          </Field>
          <Field label={t('Último día (opcional)')} error={shown.endDate}>
            <input class={`input ${shown.endDate ? 'is-invalid' : ''}`} type="date" value={m.endDate ?? ''} onInput={(ev) => upd((x) => void (x.endDate = ev.currentTarget.value || null))} />
          </Field>
        </div>
        <div class="grid grid--2">
          <Field label={t('Estilo')}>
            <StylePicker value={m.style} onChange={(v) => upd((x) => void (x.style = v))} />
          </Field>
          <Field label={t('Sonido al empezar')}>
            <label class="mini-toggle">
              <Toggle checked={m.sound} onChange={(v) => upd((x) => void (x.sound = v))} />
              <span>{m.sound ? t('Con aviso sonoro') : t('Silencioso')}</span>
            </label>
          </Field>
        </div>
        {screens.length > 1 && (
          <Field label={t('Pantallas')}>
            <ScreenTargets screens={screens} value={m.screenIds} onChange={(v) => upd((x) => void (x.screenIds = v))} />
          </Field>
        )}
        <AlertCardPreview emoji={m.emoji} title={m.title} body={m.body} style={m.style} />
      </div>
    </Modal>
  );
}

function scheduleWhen(m: ScheduledMessage, wd: string[]) {
  const days = !m.days.length ? t('Todos los días') : m.days.length === 5 && [1, 2, 3, 4, 5].every((d) => m.days.includes(d)) ? t('Lunes a viernes') : m.days.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => wd[d]).join(', ');
  let s = `${days} · ${m.from}–${m.to}`;
  if (m.startDate || m.endDate) s += ` · ${m.startDate ? fmtDay(m.startDate, { weekday: false }) : '…'} → ${m.endDate ? fmtDay(m.endDate, { weekday: false }) : '…'}`;
  return s;
}

/* ---------------------------------------------------------------- page */

export function AlertsSection({ full, setFull, cfg, set, errors, saved }: SectionProps) {
  const [data, setData] = useState<AnnouncementsResponse | null>(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<{ m: ScheduledMessage; isNew: boolean } | null>(null);
  const [showHist, setShowHist] = useState(false);
  const [, tick] = useState(0);
  const tz = cfg.datetime.timezone;
  const wd = weekdayNames('short');
  const al = cfg.alerts;
  const ann = has('announcements');
  const schedOn = has('schedules');

  const load = async () => {
    if (!ann) return;
    try {
      setData(await api.announcements());
      setErr('');
    } catch (e) {
      setErr((e as ApiError).message);
    }
  };
  useEffect(() => {
    load();
    const id = setInterval(() => {
      load();
      tick((n) => n + 1);
    }, 5000);
    if (takeIntent('alerts', 'focus')) setTimeout(() => (document.querySelector('#al-send .announce__title input, #al-send input.announce__title') as HTMLInputElement | null)?.focus(), 300);
    return () => clearInterval(id);
  }, []);

  const clearOne = async (a: Announcement) => {
    try {
      await api.clearAnnouncement(a.id);
      load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };
  const clearAll = async () => {
    if (!(await confirmDialog({ title: t('¿Quitar todos los avisos activos?'), confirm: t('Quitar todos'), danger: true }))) return;
    try {
      const r = await api.clearAnnouncements();
      toast(t('{n} avisos retirados', { n: r.cleared }));
      load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };
  const resend = async (a: Announcement) => {
    try {
      const r = await api.announce({ title: a.title, body: a.body, emoji: a.emoji, style: a.style, durationSec: a.durationSec, sound: a.sound, screens: a.screenIds });
      toast(r.delivered ? withPollNote(t('Aviso enviado a {n} pantallas', { n: r.delivered })) : t('Aviso guardado: se mostrará cuando se conecte una pantalla'));
      load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  const active = (data?.active ?? []).filter((a) => !a.clearedAt && Date.parse(a.expiresAt) > Date.now());
  const sched = full.schedules.items;

  return (
    <>
      <PageHeader title={t('Avisos')} desc={t('Mensajes que aparecen sobre el calendario: al momento, programados o desde Home Assistant (ver “API y webhooks”).')} />

      {ann && (
        <Card title={t('Enviar un aviso ahora')} icon="megaphone" id="al-send" scope="global">
          <AnnounceForm screens={saved.screens} onSent={() => load()} />
        </Card>
      )}

      {ann && (
        <Card
          title={t('Avisos activos')}
          icon="bell"
          id="al-active"
          desc={active.length ? t('{n} en pantalla ahora', { n: active.length }) : undefined}
          actions={
            active.length > 1 && (
              <Button size="sm" variant="ghost" icon="x" onClick={clearAll}>
                {t('Quitar todos')}
              </Button>
            )
          }
        >
          {err && !data ? (
            <div class="err-text small">{err}</div>
          ) : active.length === 0 ? (
            <div class="muted small">{t('No hay avisos en pantalla.')}</div>
          ) : (
            <ul class="ann-list">
              {active.map((a) => (
                <li class={`ann ann--${a.style}`}>
                  <span class="ann__emoji">{a.emoji || ALERT_STYLES.find((s) => s.value === a.style)?.emoji}</span>
                  <div class="ann__main">
                    <strong>{a.title || a.body}</strong>
                    {a.title && a.body && <p>{a.body}</p>}
                    <span class="muted small">
                      {screenNames(a.screenIds, full.screens)} · {announcementBy(a)} · {relTime(a.createdAt)}
                    </span>
                    <Remaining a={a} />
                  </div>
                  <Button size="sm" variant="ghost" icon="x" onClick={() => clearOne(a)}>
                    {t('Quitar')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {schedOn && (
        <Card
          title={t('Mensajes programados')}
          icon="clock"
          id="al-sched"
          scope="global"
          desc={t('Se muestran automáticamente en una franja horaria, p. ej. “🗑️ Sacar la basura” martes y viernes de 20:00 a 22:00.')}
          actions={
            <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing({ m: newSchedule(), isNew: true })} disabled={sched.length >= 100}>
              {t('Nuevo')}
            </Button>
          }
        >
          {sched.length === 0 ? (
            <Empty icon="clock" title={t('Sin mensajes programados')}>
              <Button
                variant="default"
                icon="plus"
                onClick={() => setEditing({ m: { ...newSchedule(), title: t('Sacar la basura') }, isNew: true })}
              >
                🗑️ {t('Sacar la basura (mar y vie, 20–22 h)')}
              </Button>
            </Empty>
          ) : (
            <ul class="sched-list">
              {sched.map((m) => {
                const on = scheduleActive(m, tz);
                const bad = Object.keys(errors).some((k) => k.startsWith(`sched.${m.id}.`));
                return (
                  <li class={`sched sched--${m.style} ${m.enabled ? '' : 'is-off'} ${bad ? 'has-err' : ''}`}>
                    <button type="button" class="sched__main" onClick={() => setEditing({ m, isNew: false })}>
                      <span class="sched__emoji">{m.emoji || '🗓️'}</span>
                      <span class="sched__text">
                        <strong>
                          {m.title || t('Sin título')}
                          {on && <span class="badge badge--ok">{t('Activo ahora')}</span>}
                          {m.sound && <Icon name="volume" size={13} class="muted" />}
                        </strong>
                        <span class="muted small">
                          {scheduleWhen(m, wd)}
                          {full.screens.length > 1 && ` · ${screenNames(m.screenIds, full.screens)}`}
                        </span>
                      </span>
                      {bad && <span class="nav__err">!</span>}
                    </button>
                    <Toggle
                      size="sm"
                      checked={m.enabled}
                      label={t('Activo')}
                      onChange={(v) =>
                        setFull((d) => {
                          const x = d.schedules.items.find((y) => y.id === m.id);
                          if (x) x.enabled = v;
                        })
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      <Card title={t('Avisos en esta pantalla')} icon="volume" id="al-screen" scope="screen">
        <ToggleRow label={t('Mostrar avisos y mensajes programados')} hint={t('Si lo desactivas, esta pantalla no recibe ningún aviso.')} checked={al.enabled} onChange={(v) => set((d) => void (d.alerts.enabled = v))} />
        <div class={`stack ${al.enabled ? '' : 'is-disabled'}`}>
          <ToggleRow label={t('Permitir sonido')} hint={t('Un tono suave sintetizado (sin archivos). Solo suena si el aviso lo pide.')} checked={al.sound} onChange={(v) => set((d) => void (d.alerts.sound = v))} />
          <div class={`vol-row ${al.sound ? '' : 'is-disabled'}`}>
            <Field label={t('Volumen')} error={errors['alerts.volume']}>
              <Slider value={al.volume} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.alerts.volume = v))} />
            </Field>
            <div class="vol-row__test">
              {ALERT_STYLES.map((s) => (
                <button type="button" class={`pill pill--${s.value}`} onClick={() => playChime(s.value, al.volume)} title={t('Probar sonido')}>
                  <Icon name="play" size={11} /> {t(s.label)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {ann && (
        <Card
          title={t('Historial')}
          icon="history"
          id="al-history"
          actions={
            <Button size="sm" variant="ghost" onClick={() => setShowHist(!showHist)}>
              {showHist ? t('Ocultar') : t('Mostrar ({n})', { n: data?.history.length ?? 0 })}
            </Button>
          }
        >
          {showHist &&
            (!data?.history.length ? (
              <div class="muted small">{t('Todavía no se ha enviado ningún aviso.')}</div>
            ) : (
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>{t('Aviso')}</th>
                      <th>{t('Enviado')}</th>
                      <th>{t('Origen')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((a) => (
                      <tr>
                        <td>
                          <span class={`style-dot style-dot--${a.style}`} /> {a.emoji} <strong>{a.title || a.body}</strong>
                          {a.clearedAt && <span class="muted small"> · {t('retirado')}</span>}
                        </td>
                        <td class="muted" title={a.createdAt}>
                          {fmtDateTime(a.createdAt)}
                        </td>
                        <td class="muted">{announcementBy(a)}</td>
                        <td class="num">
                          <Button size="sm" variant="ghost" icon="refresh" onClick={() => resend(a)}>
                            {t('Reenviar')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </Card>
      )}

      {editing && (
        <ScheduleEditor
          initial={editing.m}
          isNew={editing.isNew}
          screens={full.screens}
          onClose={() => setEditing(null)}
          onSave={(m) => {
            setFull((d) => {
              const i = d.schedules.items.findIndex((x) => x.id === m.id);
              if (i >= 0) d.schedules.items[i] = m;
              else d.schedules.items.push(m);
            });
            setEditing(null);
            toast(t('Guarda para publicar los cambios'), 'info', 2000);
          }}
          onDelete={
            editing.isNew
              ? undefined
              : async () => {
                  if (!(await confirmDialog({ title: t('Eliminar “{name}”', { name: editing.m.title }), confirm: t('Eliminar'), danger: true }))) return;
                  setFull((d) => void (d.schedules.items = d.schedules.items.filter((x) => x.id !== editing.m.id)));
                  setEditing(null);
                }
          }
        />
      )}
    </>
  );
}
