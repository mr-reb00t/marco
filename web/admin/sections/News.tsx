import { useEffect, useState } from 'preact/hooks';
import type { MicrosoftAccount, MicrosoftTodoListItem, NewsFeed, TestRssResponse } from '../../shared/types';
import { api, ApiError } from '../api';
import { fetchErrorText } from '../apiErrors';
import { confirmDialog } from '../components/feedback';
import { Icon, MicrosoftLogo } from '../components/icons';
import { Button, Callout, Card, EmojiPicker, Empty, Field, NumberInput, PageHeader, ReorderButtons, Slider, Textarea, TextInput, Toggle, ToggleRow } from '../components/ui';
import { ScopeBadge } from '../components/ui';
import { atLimit, has } from '../caps';
import { LimitNote } from '../components/LimitNote';
import { t } from '../i18n';
import { isHttpUrl, moveItem, uid } from '../util';
import type { SectionProps } from './common';

function FeedRow({ f, i, n, errors, upd, remove, move }: { f: NewsFeed; i: number; n: number; errors: Record<string, string>; upd: (fn: (x: NewsFeed) => void) => void; remove: () => void; move: (a: number, b: number) => void }) {
  const [test, setTest] = useState<{ loading: boolean; res?: TestRssResponse }>({ loading: false });
  const valid = isHttpUrl(f.url);
  const run = async () => {
    setTest({ loading: true });
    try {
      setTest({ loading: false, res: await api.testRss(f.url.trim()) });
    } catch (e) {
      setTest({ loading: false, res: { ok: false, error: (e as ApiError).message } });
    }
  };
  return (
    <div class={`feed ${f.enabled ? '' : 'is-off'}`}>
      <div class="feed__row">
        <TextInput class="feed__name" value={f.name} placeholder={t('Nombre')} error={!!errors[`feed.${f.id}.name`]} onValue={(v) => upd((x) => void (x.name = v))} />
        <TextInput
          class="feed__url"
          mono
          value={f.url}
          placeholder="https://…/rss"
          error={!!errors[`feed.${f.id}.url`]}
          onValue={(v) => {
            upd((x) => void (x.url = v));
            setTest({ loading: false });
          }}
          suffix={
            f.url ? (
              <span class={valid ? 'ok-text' : 'err-text'}>
                <Icon name={valid ? 'check' : 'x'} size={14} />
              </span>
            ) : undefined
          }
        />
        <Button size="sm" icon="play" disabled={!valid} loading={test.loading} onClick={run}>
          {t('Probar')}
        </Button>
        <Toggle checked={f.enabled} onChange={(v) => upd((x) => void (x.enabled = v))} label={t('Activo')} />
        <ReorderButtons index={i} count={n} onMove={move} />
        <button type="button" class="icon-btn icon-btn--danger" onClick={remove} aria-label={t('Eliminar')}>
          <Icon name="trash" size={16} />
        </button>
      </div>
      {test.res && (
        <div class={`test-result ${test.res.ok ? 'is-ok' : 'is-err'}`}>
          {test.res.ok ? (
            <span>
              <Icon name="check" size={14} /> <strong>{test.res.title || f.name}</strong> · {t('{n} noticias', { n: test.res.count ?? 0 })}
            </span>
          ) : (
            <span>
              <Icon name="alert" size={14} /> {fetchErrorText(test.res.error) || t('Feed no válido')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function NewsSection({ cfg, set, errors }: SectionProps) {
  const n = cfg.news;
  const move = (a: number, b: number) => set((d) => void (d.news.feeds = moveItem(d.news.feeds, a, b)));
  return (
    <>
      <PageHeader title={t('Noticias')} desc={t('Titulares RSS que van rotando en la pantalla.')} />
      <Card
        title={t('Fuentes RSS')}
        id="news-feeds"
        icon="news"
        actions={
          <Button size="sm" variant="primary" icon="plus" disabled={atLimit('newsFeeds', n.feeds.length)} onClick={() => set((d) => void d.news.feeds.push({ id: uid('n'), name: '', url: '', enabled: true }))}>
            {t('Añadir feed')}
          </Button>
        }
      >
        <ToggleRow label={<>{t('Mostrar noticias')} <ScopeBadge scope="screen" /></>} checked={n.enabled} onChange={(v) => set((d) => void (d.news.enabled = v))} />
        <div class={`stack ${n.enabled ? '' : 'is-disabled'}`}>
          <LimitNote name="newsFeeds" count={n.feeds.length} />
          {n.feeds.length === 0 ? (
            <Empty icon="news" title={t('Sin feeds')}>
              {t('Añade la URL RSS de tu periódico favorito.')}
            </Empty>
          ) : (
            n.feeds.map((f, i) => (
              <FeedRow
                key={f.id}
                f={f}
                i={i}
                n={n.feeds.length}
                errors={errors}
                move={move}
                remove={() => set((d) => void (d.news.feeds = d.news.feeds.filter((x) => x.id !== f.id)))}
                upd={(fn) =>
                  set((d) => {
                    const x = d.news.feeds.find((y) => y.id === f.id);
                    if (x) fn(x);
                  })
                }
              />
            ))
          )}
          <div class="grid grid--2">
            <Field label={<>{t('Cambiar titular cada')} <ScopeBadge scope="screen" /></>} error={errors['news.rotateSec']}>
              <Slider value={n.rotateSec} min={5} max={60} step={1} format={(v) => `${v} s`} onChange={(v) => set((d) => void (d.news.rotateSec = v))} />
            </Field>
            <Field label={t('Máximo de titulares')} error={errors['news.maxItems']}>
              <NumberInput value={n.maxItems} min={1} max={200} error={!!errors['news.maxItems']} onValue={(v) => set((d) => void (d.news.maxItems = v))} />
            </Field>
          </div>
        </div>
      </Card>
    </>
  );
}

/** Most Microsoft To Do lists on the to-do list (server/core/validate.js MAX_TODO_LISTS). */
const MAX_TODO_LISTS = 10;

/**
 * Microsoft To Do lists shown with the typed tasks: each linked Microsoft account (linked in Calendars) lists its To
 * Do lists to pick from, like its calendars. An account linked before Marco asked for To Do access offers to connect
 * it again. Shown only where Microsoft accounts can be linked.
 */
function MicrosoftTodoCard({ cfg, set, dirty, save }: SectionProps) {
  const [accounts, setAccounts] = useState<MicrosoftAccount[] | null>(null);
  const [lists, setLists] = useState<Record<string, MicrosoftTodoListItem[] | 'reconnect' | 'error' | undefined>>({});
  const chosen = cfg.todo.lists ?? [];
  useEffect(() => {
    api.microsoftAccounts().then(
      (list) => {
        setAccounts(list);
        for (const a of list) {
          if (a.tasks === false) {
            setLists((m) => ({ ...m, [a.email]: 'reconnect' }));
            continue;
          }
          api.microsoftTodoLists(a.email).then(
            (l) => setLists((m) => ({ ...m, [a.email]: l })),
            (e) => setLists((m) => ({ ...m, [a.email]: ((e as ApiError).body as { error?: string } | undefined)?.error === 'microsoft_tasks_reconnect' ? 'reconnect' : 'error' })),
          );
        }
      },
      () => setAccounts([]),
    );
  }, []);

  /** Connect the same account again (Microsoft preselects it); its calendars and lists stay. */
  const reconnect = async (email: string) => {
    if (dirty) {
      const ok = await confirmDialog({
        title: t('Guardar cambios antes de continuar'),
        body: t('Vas a salir a Microsoft para vincular la cuenta. ¿Guardamos primero los cambios pendientes?'),
        confirm: t('Guardar y continuar'),
      });
      if (!ok || !(await save())) return;
    }
    window.location.href = `/auth/microsoft/connect?account=${encodeURIComponent(email)}&back=todo`;
  };
  const isOn = (email: string, id: string) => chosen.some((l) => l.microsoftAccount === email && l.microsoftListId === id);
  const toggle = (email: string, l: MicrosoftTodoListItem, on: boolean) =>
    set((d) => {
      d.todo.lists ??= [];
      if (on) {
        if (isOn(email, l.id) || d.todo.lists.length >= MAX_TODO_LISTS) return;
        d.todo.lists.push({ id: uid('tl'), type: 'microsoft', microsoftAccount: email, microsoftListId: l.id, name: l.name, enabled: true });
      } else {
        d.todo.lists = d.todo.lists.filter((x) => !(x.microsoftAccount === email && x.microsoftListId === l.id));
      }
    });
  const readOnly = (a: MicrosoftAccount) => a.tasks !== false && a.tasksWrite === false && chosen.some((l) => l.microsoftAccount === a.email);

  return (
    <Card
      id="todo-microsoft"
      title={t('Listas de Microsoft To Do')}
      icon="microsoft"
      scope="global"
      desc={t('Las tareas pendientes de las listas que elijas salen junto a las de aquí, con su fecha y una estrella si son importantes. Se actualizan cada 5 minutos.')}
    >
      {accounts === null ? (
        <div class="skeleton" />
      ) : accounts.length === 0 ? (
        <Empty icon="link" title={t('Ninguna cuenta de Microsoft vinculada')}>
          {t('Vincula tu cuenta de Microsoft en')} <a href="#/calendars/cal-accounts">{t('Calendarios')}</a>.
        </Empty>
      ) : (
        <div class="gaccounts">
          {accounts.map((a) => {
            const l = lists[a.email];
            return (
              <div class="gaccount">
                <div class="gaccount__head">
                  <span class="avatar avatar--letter">{a.email[0].toUpperCase()}</span>
                  <div class="gaccount__who">
                    <strong>{a.email}</strong>
                    <span class="muted small">
                      <MicrosoftLogo size={12} /> Microsoft To Do
                    </span>
                  </div>
                </div>
                {l === undefined ? (
                  <div class="skeleton" />
                ) : l === 'reconnect' ? (
                  <Callout kind="warn">
                    {t('Vuelve a vincular la cuenta para ver tus listas de To Do.')}{' '}
                    <Button size="sm" variant="ghost" icon="link" onClick={() => reconnect(a.email)}>
                      {t('Volver a vincular')}
                    </Button>
                  </Callout>
                ) : l === 'error' ? (
                  <Callout kind="error">{t('No se pudieron leer las listas de To Do. Inténtalo más tarde.')}</Callout>
                ) : l.length === 0 ? (
                  <p class="muted small">{t('Esta cuenta no tiene listas de To Do.')}</p>
                ) : (
                  <>
                  {readOnly(a) && (
                    <p class="muted small">
                      {t('Estas listas solo se pueden leer: vuelve a vincular la cuenta para poder marcarlas desde la pantalla.')}{' '}
                      <Button size="sm" variant="ghost" icon="link" onClick={() => reconnect(a.email)}>
                        {t('Volver a vincular')}
                      </Button>
                    </p>
                  )}
                  <ul class="gcal-list">
                    {l.map((x) => {
                      const on = isOn(a.email, x.id);
                      return (
                        <li>
                          <label class={`gcal ${on ? 'is-on' : ''}`}>
                            <input type="checkbox" checked={on} disabled={!on && chosen.length >= MAX_TODO_LISTS} onChange={(e) => toggle(a.email, x, e.currentTarget.checked)} />
                            <span class="check-box">
                              <Icon name="check" size={12} />
                            </span>
                            <span class="gcal__name">{x.name}</span>
                            {x.shared && <span class="badge badge--soft">{t('Compartida')}</span>}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ToggleRow
        label={<>{t('Permitir marcar tocando esta pantalla')} <ScopeBadge scope="screen" /></>}
        hint={t('Una tarea de To Do tocada en la pantalla se marca como hecha también en Microsoft. Es el mismo ajuste que el de las rutinas de Familia. No funciona en modo privado.')}
        checked={!!cfg.family.touch}
        onChange={(v) => set((d) => void (d.family.touch = v))}
      />
    </Card>
  );
}

export function TodoSection(props: SectionProps) {
  const { cfg, set, me } = props;
  const td = cfg.todo;
  const [text, setText] = useState('');
  const add = (e: Event) => {
    e.preventDefault();
    if (!text.trim()) return;
    set((d) => void d.todo.items.push({ id: uid('t'), text: text.trim(), done: false }));
    setText('');
  };
  const move = (a: number, b: number) => set((d) => void (d.todo.items = moveItem(d.todo.items, a, b)));
  return (
    <>
      <PageHeader title={t('Tareas')} desc={t('Una lista sencilla de pendientes visible en la pantalla.')} />
      <Card title={t('Lista de tareas')} icon="checklist">
        <ToggleRow label={<>{t('Mostrar tareas')} <ScopeBadge scope="screen" /></>} checked={td.enabled} onChange={(v) => set((d) => void (d.todo.enabled = v))} />
        <form class="search-row" onSubmit={add}>
          <TextInput value={text} onValue={setText} placeholder={t('Nueva tarea…')} />
          <Button type="submit" variant="primary" icon="plus">
            {t('Añadir')}
          </Button>
        </form>
        {td.items.length === 0 ? (
          <Empty icon="checklist" title={t('Nada pendiente')} />
        ) : (
          <ul class="todo-list">
            {td.items.map((it, i) => (
              <li key={it.id} class={it.done ? 'is-done' : ''}>
                <label class="todo-check">
                  <input type="checkbox" checked={it.done} onChange={(e) => set((d) => void (d.todo.items[i].done = e.currentTarget.checked))} />
                  <span class="check-box">
                    <Icon name="check" size={12} />
                  </span>
                </label>
                <input class="input input--bare" value={it.text} onInput={(e) => set((d) => void (d.todo.items[i].text = e.currentTarget.value))} />
                <ReorderButtons index={i} count={td.items.length} onMove={move} />
                <button type="button" class="icon-btn icon-btn--danger" aria-label={t('Eliminar')} onClick={() => set((d) => void d.todo.items.splice(i, 1))}>
                  <Icon name="trash" size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {td.items.some((x) => x.done) && (
          <Button size="sm" variant="ghost" onClick={() => set((d) => void (d.todo.items = d.todo.items.filter((x) => !x.done)))}>
            {t('Borrar completadas')}
          </Button>
        )}
      </Card>
      {has('microsoftCalendar') && !!me.microsoftConfigured && <MicrosoftTodoCard {...props} />}
    </>
  );
}

export function MessageSection({ cfg, set }: SectionProps) {
  const m = cfg.message;
  return (
    <>
      <PageHeader scope="screen" title={t('Mensaje')} desc={t('Un aviso personalizado destacado en la pantalla.')} />
      <Card scope="screen" title={t('Mensaje personalizado')} icon="message">
        <ToggleRow label={t('Mostrar mensaje')} checked={m.enabled} onChange={(v) => set((d) => void (d.message.enabled = v))} />
        <div class="message-editor">
          <EmojiPicker size="lg" value={m.emoji} allowNone onChange={(v) => set((d) => void (d.message.emoji = v))} />
          <Textarea value={m.text} rows={3} maxLength={280} placeholder={t('¡Bienvenidos a casa! 🏡')} onValue={(v) => set((d) => void (d.message.text = v))} />
        </div>
        <div class="field__hint">{m.text.length}/280</div>
        {m.text && (
          <div class="message-preview">
            <span>{m.emoji}</span>
            <p>{m.text}</p>
          </div>
        )}
      </Card>
    </>
  );
}
