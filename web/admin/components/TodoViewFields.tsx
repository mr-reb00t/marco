// What one to-do surface shows (#15, server/core/todoCore.js): its lists, title, icon and which tasks. Used by the
// to-do card of the Personalizado editor (builder/fields.tsx) and by the screen's to-do part on the Tareas page.
import type { TodoFilter, TodoList, TodoView } from '../../shared/types';
import { LOCAL_TODO_LIST, TODO_TITLE_MAX } from '../../../server/core/todoCore.js';
import { t } from '../i18n';
import { Icon } from './icons';
import { EmojiPicker, Field, Segmented, TextInput } from './ui';

/** `lists`: the household's Microsoft To Do lists (config todo.lists, with their account: the admin only). */
export function TodoViewFields({ value, lists, onChange }: { value: Partial<TodoView>; lists: TodoList[]; onChange: (k: keyof TodoView, v: unknown, merge?: boolean) => void }) {
  const ids = Array.isArray(value.listIds) ? value.listIds : null;
  const all = [LOCAL_TODO_LIST, ...lists.map((l) => l.id)];
  // a list removed meanwhile is not offered (the server drops it on save)
  const picked = ids ? ids.filter((id) => all.includes(id)) : null;
  const flip = (id: string, on: boolean) => {
    const cur = picked ?? all;
    const next = on ? [...cur.filter((x) => x !== id), id] : cur.filter((x) => x !== id);
    if (next.length) onChange('listIds', all.filter((x) => next.includes(x)));
  };
  // two accounts may each have a "Tasks" list: the account shows under every Microsoft list
  const rows = [{ id: LOCAL_TODO_LIST, name: t('Tareas escritas en Marco'), sub: '' }, ...lists.map((l) => ({ id: l.id, name: l.name || t('Lista sin nombre'), sub: l.microsoftAccount }))];
  const one = picked?.length === 1 ? picked[0] : null;
  const auto = one && one !== LOCAL_TODO_LIST ? lists.find((l) => l.id === one)?.name || t('Tareas') : t('Tareas');
  return (
    <>
      <Field label={t('Listas')} hint={lists.length ? undefined : t('Las listas de Microsoft To Do se eligen en la sección Tareas.')}>
        <Segmented
          full
          value={picked ? 'some' : 'all'}
          options={[{ value: 'all', label: t('Todas') }, { value: 'some', label: t('Elegir') }]}
          onChange={(v) => onChange('listIds', v === 'all' ? null : all)}
        />
        {picked && (
          <ul class="gcal-list todo-view__lists">
            {rows.map((r) => {
              const on = picked.includes(r.id);
              return (
                <li>
                  <label class={`gcal ${on ? 'is-on' : ''}`}>
                    <input type="checkbox" checked={on} disabled={on && picked.length === 1} onChange={(e) => flip(r.id, e.currentTarget.checked)} />
                    <span class="check-box">
                      <Icon name="check" size={12} />
                    </span>
                    <span class="gcal__name">
                      {r.name}
                      {r.sub && <span class="muted small todo-view__acct"> {r.sub}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Field>
      <Field label={t('Título')} hint={t('Vacío: «Tareas», o el nombre de la lista cuando eliges solo una.')}>
        <TextInput value={value.title ?? ''} maxLength={TODO_TITLE_MAX} placeholder={auto} onValue={(v) => onChange('title', v, true)} />
      </Field>
      <Field label={t('Icono')} hint={t('Sin icono: ✅.')}>
        <EmojiPicker value={value.icon ?? ''} allowNone onChange={(v) => onChange('icon', v)} />
      </Field>
      <Field label={t('Qué tareas')} hint={t('«Para hoy»: las que vencen hoy o ya vencieron. Las tareas escritas en Marco no tienen estrella ni fecha, así que solo salen con «Todas».')}>
        <Segmented
          full
          value={value.filter ?? 'all'}
          options={[
            { value: 'all', label: t('Todas') },
            { value: 'important', label: t('Importantes') },
            { value: 'due', label: t('Para hoy') },
          ]}
          onChange={(v) => onChange('filter', v as TodoFilter)}
        />
      </Field>
    </>
  );
}
