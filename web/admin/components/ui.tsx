import type { ComponentChildren, HTMLAttributes } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { EMOJI_CATEGORIES } from '../emoji-data';
import { buildEmojiIndex, emojiName, looksLikeEmoji, searchEmoji, type EmojiEntry, type EmojiIndex } from '../emojiSearch';
import { getLang, t } from '../i18n';
import { EMOJI_GRID, HEX_RE, SWATCHES } from '../util';
import { confirmDialog } from './feedback';
import { Icon, type IconName } from './icons';

/* ------------------------------------------------------------------ layout */

export function Card(props: {
  title?: ComponentChildren;
  desc?: ComponentChildren;
  icon?: IconName;
  actions?: ComponentChildren;
  children?: ComponentChildren;
  class?: string;
  muted?: boolean;
  /** "Solo esta pantalla" / "Todas las pantallas" badge next to the title. */
  scope?: 'screen' | 'global';
  id?: string;
}) {
  return (
    <section class={`card ${props.muted ? 'card--muted' : ''} ${props.class ?? ''}`} id={props.id}>
      {(props.title || props.actions) && (
        <header class="card__head">
          {props.icon && (
            <span class="card__icon">
              <Icon name={props.icon} size={18} />
            </span>
          )}
          <div class="card__titles">
            {props.title && (
              <h3>
                {props.title}
                {props.scope && <ScopeBadge scope={props.scope} />}
              </h3>
            )}
            {props.desc && <p>{props.desc}</p>}
          </div>
          {props.actions && <div class="card__actions">{props.actions}</div>}
        </header>
      )}
      <div class="card__body">{props.children}</div>
    </section>
  );
}

export function PageHeader({ title, desc, children, scope }: { title: string; desc?: string; children?: ComponentChildren; scope?: 'screen' | 'global' }) {
  return (
    <div class="page-head">
      <div>
        <h1>
          {title}
          {scope && <ScopeBadge scope={scope} />}
        </h1>
        {desc && <p>{desc}</p>}
      </div>
      {children && <div class="page-head__actions">{children}</div>}
    </div>
  );
}

export function Field(props: {
  label?: ComponentChildren;
  hint?: ComponentChildren;
  error?: string;
  children: ComponentChildren;
  class?: string;
  htmlFor?: string;
}) {
  return (
    <div class={`field ${props.error ? 'field--error' : ''} ${props.class ?? ''}`}>
      {props.label && (
        <label class="field__label" for={props.htmlFor}>
          {props.label}
        </label>
      )}
      {props.children}
      {props.error ? (
        <div class="field__error">
          <Icon name="alert" size={13} /> {t(props.error)}
        </div>
      ) : (
        props.hint && <div class="field__hint">{props.hint}</div>
      )}
    </div>
  );
}

export function Grid({ children, cols = 2 }: { children: ComponentChildren; cols?: 2 | 3 | 4 }) {
  return <div class={`grid grid--${cols}`}>{children}</div>;
}

/* ------------------------------------------------------------------ inputs */

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string; size?: 'sm' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      class={`toggle ${props.checked ? 'is-on' : ''} ${props.size === 'sm' ? 'toggle--sm' : ''}`}
      onClick={() => props.onChange(!props.checked)}
    >
      <span class="toggle__knob" />
    </button>
  );
}

export function ToggleRow(props: {
  label: ComponentChildren;
  hint?: ComponentChildren;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  icon?: string;
}) {
  return (
    <div class={`toggle-row ${props.disabled ? 'is-disabled' : ''}`}>
      {props.icon && <span class="toggle-row__emoji">{props.icon}</span>}
      <div class="toggle-row__text" onClick={() => !props.disabled && props.onChange(!props.checked)}>
        <div class="toggle-row__label">{props.label}</div>
        {props.hint && <div class="toggle-row__hint">{props.hint}</div>}
      </div>
      <Toggle checked={props.checked} onChange={props.onChange} disabled={props.disabled} label={typeof props.label === 'string' ? props.label : undefined} />
    </div>
  );
}

export interface SegOption<T> {
  value: T;
  label: ComponentChildren;
  icon?: IconName;
  title?: string;
  /** shown but not selectable (greyed out); `title` says why. aria-disabled, not disabled, so the tooltip still shows. */
  off?: boolean;
}

export function Segmented<T extends string | number>(props: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  full?: boolean;
  size?: 'sm';
  disabled?: boolean;
}) {
  const idx = Math.max(0, props.options.findIndex((o) => o.value === props.value));
  const n = props.options.length;
  return (
    <div
      class={`seg ${props.full ? 'seg--full' : ''} ${props.size === 'sm' ? 'seg--sm' : ''} ${props.disabled ? 'is-disabled' : ''}`}
      role="radiogroup"
      style={{ '--seg-n': n, '--seg-i': idx } as any}
    >
      <span class="seg__thumb" aria-hidden="true" />
      {props.options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          class={`${o.value === props.value ? 'is-active' : ''} ${o.off ? 'is-off' : ''}`}
          title={o.title}
          disabled={props.disabled}
          aria-disabled={o.off ? 'true' : undefined}
          onClick={() => !o.off && props.onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={15} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

type InputProps = Omit<HTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onInput' | 'size' | 'prefix'> & {
  value: string;
  onValue: (v: string) => void;
  error?: boolean;
  mono?: boolean;
  type?: string;
  placeholder?: string;
  autocomplete?: string;
  list?: string;
  disabled?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  prefix?: ComponentChildren;
  suffix?: ComponentChildren;
};

/**
 * Fields that are not a sign in (autocomplete "off": API keys, Client ID and Secret, tokens) tell password managers
 * to leave them alone, and a key field is a masked text field rather than a password field: browsers fill the email
 * and password of the account into a text field followed by a password field (the Spotify app keys, #18).
 */
export const NOT_A_LOGIN = { 'data-1p-ignore': '', 'data-lpignore': 'true', 'data-bwignore': '', 'data-form-type': 'other' };

export function TextInput({ value, onValue, error, mono, prefix, suffix, class: cls, ...rest }: InputProps) {
  const r = rest as any;
  const notLogin = r.autocomplete === 'off';
  const masked = notLogin && r.type === 'password';
  const input = (
    <input
      {...r}
      {...(notLogin ? NOT_A_LOGIN : {})}
      type={masked ? 'text' : r.type}
      class={`input ${mono ? 'input--mono' : ''} ${masked ? 'input--masked' : ''} ${error ? 'is-invalid' : ''} ${prefix || suffix ? '' : (cls as string) ?? ''}`}
      value={value}
      onInput={(e) => onValue(e.currentTarget.value)}
      spellcheck={false}
    />
  );
  if (!prefix && !suffix) return input;
  return (
    <div class={`input-group ${error ? 'is-invalid' : ''} ${(cls as string) ?? ''}`}>
      {prefix && <span class="input-group__addon">{prefix}</span>}
      {input}
      {suffix && <span class="input-group__addon">{suffix}</span>}
    </div>
  );
}

export function NumberInput(props: {
  value: number;
  onValue: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  error?: boolean;
  suffix?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => {
    if (Number(text) !== props.value) setText(String(props.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);
  return (
    <div class={`input-group ${props.error ? 'is-invalid' : ''}`}>
      <input
        class="input"
        type="number"
        inputMode="decimal"
        value={text}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        disabled={props.disabled}
        onInput={(e) => {
          const v = e.currentTarget.value;
          setText(v);
          const n = parseFloat(v);
          if (Number.isFinite(n)) props.onValue(n);
          else props.onValue(NaN);
        }}
      />
      {props.suffix && <span class="input-group__addon">{props.suffix}</span>}
    </div>
  );
}

export function Select<T extends string | number>(props: {
  value: T;
  /** `group`: options with a group are shown under that heading (in the order the groups first appear) */
  options: { value: T; label: string; group?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  error?: boolean;
}) {
  const opt = (o: { value: T; label: string }) => <option value={String(o.value)}>{o.label}</option>;
  const groups = [...new Set(props.options.map((o) => o.group).filter((g): g is string => !!g))];
  return (
    <div class={`select ${props.error ? 'is-invalid' : ''}`}>
      <select
        disabled={props.disabled}
        value={String(props.value)}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          const found = props.options.find((o) => String(o.value) === raw);
          if (found) props.onChange(found.value);
        }}
      >
        {groups.length
          ? [
              ...props.options.filter((o) => !o.group).map(opt),
              ...groups.map((g) => <optgroup label={g}>{props.options.filter((o) => o.group === g).map(opt)}</optgroup>),
            ]
          : props.options.map(opt)}
      </select>
      <Icon name="down" size={14} class="select__chev" />
    </div>
  );
}

export function Slider(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  const pct = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <div class="slider">
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 0.01}
        value={props.value}
        disabled={props.disabled}
        style={{ '--pct': `${Math.min(100, Math.max(0, pct))}%` } as any}
        onInput={(e) => props.onChange(parseFloat(e.currentTarget.value))}
      />
      <output class="slider__value">{props.format ? props.format(props.value) : props.value}</output>
    </div>
  );
}

export function Textarea(props: { value: string; onValue: (v: string) => void; rows?: number; mono?: boolean; placeholder?: string; maxLength?: number }) {
  return (
    <textarea
      class={`input textarea ${props.mono ? 'input--mono' : ''}`}
      rows={props.rows ?? 4}
      value={props.value}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      spellcheck={!props.mono}
      onInput={(e) => props.onValue(e.currentTarget.value)}
    />
  );
}

/* ------------------------------------------------------------------ popovers */

/** `panel`: a popover body rendered elsewhere in the DOM (portal) that also counts as "inside". */
function usePopover(panel?: { current: HTMLElement | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      const n = e.target as Node;
      if (ref.current && !ref.current.contains(n) && !panel?.current?.contains(n)) setOpen(false);
    };
    // Capture phase + preventDefault: Escape closes the popover only, not the Modal around it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return { open, setOpen, ref };
}

export function ColorPicker(props: { value: string | null; onChange: (v: string | null) => void; allowNone?: boolean; error?: boolean; compact?: boolean }) {
  const { open, setOpen, ref } = usePopover();
  const [text, setText] = useState(props.value ?? '');
  useEffect(() => setText(props.value ?? ''), [props.value]);
  const v = props.value;
  return (
    <div class="pop" ref={ref}>
      <button
        type="button"
        class={`swatch-btn ${props.error ? 'is-invalid' : ''} ${props.compact ? 'swatch-btn--compact' : ''}`}
        onClick={() => setOpen(!open)}
        aria-label={t('Color')}
        title={v ?? t('Sin color')}
      >
        <span class={`swatch ${v ? '' : 'swatch--none'}`} style={v ? { background: v } : undefined} />
        {!props.compact && <span class="swatch-btn__hex">{v ?? t('Auto')}</span>}
      </button>
      {open && (
        <div class="pop__panel pop__panel--color">
          <div class="swatch-grid">
            {SWATCHES.map((c) => (
              <button
                type="button"
                class={`swatch swatch--lg ${c.toLowerCase() === v?.toLowerCase() ? 'is-active' : ''}`}
                style={{ background: c }}
                aria-label={c}
                onClick={() => {
                  props.onChange(c);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <div class="color-custom">
            <label class="color-native">
              <input type="color" value={v && HEX_RE.test(v) && v.length === 7 ? v : '#888888'} onInput={(e) => props.onChange(e.currentTarget.value)} />
              <Icon name="palette" size={16} />
            </label>
            <input
              class="input input--mono input--sm"
              value={text}
              placeholder="#rrggbb"
              onInput={(e) => {
                const s = e.currentTarget.value.trim();
                setText(s);
                if (HEX_RE.test(s)) props.onChange(s);
              }}
            />
            {props.allowNone && (
              <button
                type="button"
                class="btn btn--ghost btn--sm"
                onClick={() => {
                  props.onChange(null);
                  setOpen(false);
                }}
              >
                {t('Ninguno')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

let emojiIdx: EmojiIndex | null = null;
const emojiIndex = () =>
  (emojiIdx ??= buildEmojiIndex(EMOJI_CATEGORIES, { id: 'frequent', icon: '⭐', title: 'Frecuentes', emojis: EMOJI_GRID }));

type PanelPos = { left: number; width: number; maxHeight: number; top?: number; bottom?: number; up: boolean };

/** Fixed position next to the trigger: below it, or above when there is clearly more room there; always inside the viewport. */
function placeEmojiPanel(anchor: DOMRect): PanelPos {
  const M = 8;
  const GAP = 6;
  const vv = window.visualViewport;
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vTop = vv ? vv.offsetTop : 0;
  const vBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const width = Math.min(340, vw - 2 * M);
  let left = anchor.left;
  if (left + width > vw - M) left = anchor.right - width;
  left = Math.max(M, Math.min(left, vw - width - M));
  const below = vBottom - anchor.bottom - GAP - M;
  const above = anchor.top - vTop - GAP - M;
  const WANT = 430;
  const up = below < Math.min(WANT, 320) && above > below;
  const room = Math.max(up ? above : below, 180);
  const maxHeight = Math.min(WANT, room);
  return up
    ? { left, width, maxHeight, bottom: window.innerHeight - anchor.top + GAP, up }
    : { left, width, maxHeight, top: anchor.bottom + GAP, up };
}

/** Arrow-key target among the grid buttons, by position on screen (rows differ between sections). */
function emojiNeighbour(buttons: HTMLElement[], from: HTMLElement, key: string): HTMLElement | null {
  const i = buttons.indexOf(from);
  if (key === 'ArrowLeft') return buttons[i - 1] ?? null;
  if (key === 'ArrowRight') return buttons[i + 1] ?? null;
  if (key === 'Home') return buttons[0] ?? null;
  if (key === 'End') return buttons[buttons.length - 1] ?? null;
  const r = from.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const down = key === 'ArrowDown';
  let rowTop: number | null = null;
  let best: HTMLElement | null = null;
  let bestDx = Infinity;
  for (const b of buttons) {
    const br = b.getBoundingClientRect();
    if (down ? br.top <= r.top + 4 : br.top >= r.top - 4) continue;
    if (rowTop === null || (down ? br.top < rowTop - 4 : br.top > rowTop + 4)) {
      rowTop = br.top;
      best = null;
      bestDx = Infinity;
    }
    if (Math.abs(br.top - rowTop) > 4) continue;
    const dx = Math.abs(br.left + br.width / 2 - cx);
    if (dx < bestDx) {
      bestDx = dx;
      best = b;
    }
  }
  return best;
}

const canHover = () => {
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return false;
  }
};

export function EmojiPicker(props: {
  value: string;
  onChange: (v: string) => void;
  allowNone?: boolean;
  error?: boolean;
  size?: 'lg';
  /** what the button shows instead of the emoji (a profile photo) */
  face?: ComponentChildren;
  /** button label (default "Elegir emoji") */
  label?: string;
  /** extra actions above the search (`close` shuts the panel) */
  top?: (close: () => void) => ComponentChildren;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { open, setOpen, ref } = usePopover(panelRef);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pick = (v: string) => {
    props.onChange(v);
    setOpen(false);
    btnRef.current?.focus({ preventScroll: true });
  };
  return (
    <div class="pop" ref={ref}>
      <button
        type="button"
        ref={btnRef}
        class={`emoji-btn ${props.size === 'lg' ? 'emoji-btn--lg' : ''} ${props.error ? 'is-invalid' : ''} ${props.value ? '' : 'is-empty'} ${props.face ? 'has-face' : ''}`}
        onClick={() => setOpen(!open)}
        aria-label={props.label ?? t('Elegir emoji')}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={props.label ?? t('Elegir emoji')}
      >
        {props.face ?? (props.value || <Icon name="plus" size={14} />)}
      </button>
      {open &&
        createPortal(
          <EmojiPanel
            panelRef={panelRef}
            anchor={btnRef}
            value={props.value}
            allowNone={props.allowNone}
            onPick={pick}
            top={props.top?.(() => {
              setOpen(false);
              btnRef.current?.focus({ preventScroll: true });
            })}
            label={props.label}
          />,
          document.body,
        )}
    </div>
  );
}

function EmojiPanel(props: {
  panelRef: { current: HTMLDivElement | null };
  anchor: { current: HTMLElement | null };
  value: string;
  allowNone?: boolean;
  onPick: (v: string) => void;
  top?: ComponentChildren;
  label?: string;
}) {
  const idx = emojiIndex();
  const lang = getLang();
  const [q, setQ] = useState('');
  const [custom, setCustom] = useState('');
  const [pos, setPos] = useState<PanelPos | null>(null);
  const [cat, setCat] = useState(idx.sections[0].id);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const a = props.anchor.current;
      if (a) setPos(placeEmojiPanel(a.getBoundingClientRect()));
    };
    const later = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', later, true);
    window.addEventListener('resize', later);
    window.visualViewport?.addEventListener('resize', later);
    window.visualViewport?.addEventListener('scroll', later);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', later, true);
      window.removeEventListener('resize', later);
      window.visualViewport?.removeEventListener('resize', later);
      window.visualViewport?.removeEventListener('scroll', later);
    };
  }, []);

  const placed = !!pos;
  useEffect(() => {
    // Desktop only: on phones and tablets the keyboard would cover half of the list.
    if (placed && canHover()) searchRef.current?.focus({ preventScroll: true });
  }, [placed]);

  const query = q.trim();
  const results = query ? searchEmoji(idx, query, lang) : null;
  const name = (e: EmojiEntry) => emojiName(e, lang) || e.e;
  const buttons = () => [...(bodyRef.current?.querySelectorAll<HTMLElement>('.emoji-grid button') ?? [])];

  const onGridKey = (ev: KeyboardEvent) => {
    const el = ev.target as HTMLElement;
    if (!el.matches?.('.emoji-grid button')) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(ev.key)) return;
    ev.preventDefault();
    const next = emojiNeighbour(buttons(), el, ev.key);
    if (next) next.focus();
    else if (ev.key === 'ArrowUp') searchRef.current?.focus();
  };

  const onSearchKey = (ev: KeyboardEvent) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      buttons()[0]?.focus();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (results?.length) props.onPick(results[0].e);
      else if (query && looksLikeEmoji(query)) props.onPick(query);
    }
  };

  const onScroll = () => {
    const body = bodyRef.current;
    if (!body || results) return;
    const top = body.getBoundingClientRect().top + 30;
    let cur = idx.sections[0].id;
    for (const sec of body.querySelectorAll<HTMLElement>('[data-cat]')) {
      if (sec.getBoundingClientRect().top <= top) cur = sec.dataset.cat!;
    }
    if (cur !== cat) setCat(cur);
  };

  const jump = (id: string) => {
    const body = bodyRef.current;
    const sec = body?.querySelector<HTMLElement>(`[data-cat="${id}"]`);
    if (!body || !sec) return;
    body.scrollTop = sec.offsetTop - body.offsetTop;
    setCat(id);
  };

  let firstTab = true;
  const grid = (list: EmojiEntry[], key: string) => (
    <div class="emoji-grid" role="group" key={key}>
      {list.map((en) => {
        const active = en.e === props.value;
        const tab = firstTab;
        firstTab = false;
        return (
          <button type="button" class={active ? 'is-active' : ''} tabIndex={tab ? 0 : -1} aria-label={name(en)} title={name(en)} onClick={() => props.onPick(en.e)}>
            {en.e}
          </button>
        );
      })}
    </div>
  );

  const style = pos
    ? { left: `${pos.left}px`, width: `${pos.width}px`, height: `${pos.maxHeight}px`, top: pos.top != null ? `${pos.top}px` : 'auto', bottom: pos.bottom != null ? `${pos.bottom}px` : 'auto', right: 'auto' }
    : { visibility: 'hidden' as const };

  return (
    <div
      ref={props.panelRef}
      class={`pop__panel pop__panel--emoji pop__panel--fixed ${pos?.up ? 'is-up' : ''}`}
      style={style}
      role="dialog"
      aria-label={props.label ?? t('Elegir emoji')}
    >
      {props.top && <div class="emoji-top">{props.top}</div>}
      <div class="emoji-search search-input">
        <Icon name="search" size={15} />
        <input
          ref={searchRef}
          class="input input--sm"
          value={q}
          placeholder={t('Buscar emoji…')}
          aria-label={t('Buscar emoji…')}
          autocomplete="off"
          spellcheck={false}
          enterKeyHint="search"
          onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={onSearchKey}
        />
        {q && (
          <button
            type="button"
            class="icon-btn"
            onClick={() => {
              setQ('');
              searchRef.current?.focus();
            }}
            aria-label={t('Borrar')}
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </div>
      {!results && (
        <div class="emoji-tabs" aria-label={t('Categorías de emoji')}>
          {idx.sections.map((s) => (
            <button type="button" tabIndex={-1} class={s.id === cat ? 'is-active' : ''} aria-label={t(s.title)} title={t(s.title)} onClick={() => jump(s.id)}>
              {s.icon}
            </button>
          ))}
        </div>
      )}
      <div class="emoji-body" ref={bodyRef} onScroll={onScroll} onKeyDown={onGridKey}>
        {results ? (
          results.length ? (
            grid(results, 'results')
          ) : (
            <div class="emoji-empty">
              <p>{t('Sin resultados para “{q}”', { q: query })}</p>
              {looksLikeEmoji(query) ? (
                <button type="button" class="btn btn--sm" onClick={() => props.onPick(query)}>
                  {t('Usar {emoji}', { emoji: query })}
                </button>
              ) : (
                <p class="emoji-empty__hint">{t('Prueba con otra palabra, en español, inglés o portugués.')}</p>
              )}
            </div>
          )
        ) : (
          idx.sections.map((s) => (
            <section class="emoji-sec" data-cat={s.id} key={s.id}>
              <h4 class="emoji-sec__title">{t(s.title)}</h4>
              {grid(s.list, s.id)}
            </section>
          ))
        )}
      </div>
      <form
        class="emoji-custom"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (custom.trim()) {
            props.onPick(custom.trim());
            setCustom('');
          }
        }}
      >
        <input
          class="input input--sm"
          placeholder={t('Otro: pega o escribe un emoji')}
          aria-label={t('Otro: pega o escribe un emoji')}
          value={custom}
          maxLength={16}
          onInput={(e) => setCustom(e.currentTarget.value)}
        />
        <button class="btn btn--sm" type="submit">
          OK
        </button>
        {props.allowNone && (
          <button type="button" class="btn btn--ghost btn--sm" onClick={() => props.onPick('')}>
            {t('Ninguno')}
          </button>
        )}
      </form>
    </div>
  );
}

export function Chips(props: { values: string[]; onChange: (v: string[]) => void; placeholder?: string; error?: boolean; validate?: (v: string) => boolean }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const parts = raw
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !props.values.some((v) => v.toLowerCase() === s.toLowerCase()));
    if (parts.length) props.onChange([...props.values, ...parts]);
    setText('');
  };
  return (
    <div class={`chips ${props.error ? 'is-invalid' : ''}`} onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
      {props.values.map((v, i) => (
        <span class={`chip ${props.validate && !props.validate(v) ? 'chip--bad' : ''}`}>
          {v}
          <button type="button" aria-label={t('Quitar')} onClick={() => props.onChange(props.values.filter((_, j) => j !== i))}>
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
      <input
        value={text}
        placeholder={props.values.length ? '' : props.placeholder}
        onInput={(e) => {
          const v = e.currentTarget.value;
          if (/[,;]/.test(v)) add(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && props.values.length) {
            props.onChange(props.values.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && add(text)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ buttons */

export function Button(
  props: {
    variant?: 'primary' | 'ghost' | 'danger' | 'subtle' | 'default';
    size?: 'sm';
    icon?: IconName;
    loading?: boolean;
    children?: ComponentChildren;
    iconOnly?: boolean;
  } & Omit<HTMLAttributes<HTMLButtonElement>, 'icon' | 'size'> & { disabled?: boolean; type?: 'button' | 'submit' }
) {
  const { variant = 'default', size, icon, loading, children, iconOnly, class: cls, ...rest } = props;
  return (
    <button
      type="button"
      {...(rest as any)}
      disabled={props.disabled || loading}
      class={`btn btn--${variant} ${size === 'sm' ? 'btn--sm' : ''} ${iconOnly ? 'btn--icon' : ''} ${loading ? 'is-loading' : ''} ${(cls as string) ?? ''}`}
    >
      {loading ? <span class="spinner" /> : icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function StatusDot({ state }: { state: 'ok' | 'error' | 'warn' | 'idle' }) {
  return <span class={`dot dot--${state}`} />;
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <span class="empty__icon">
        <Icon name={icon} size={26} />
      </span>
      <h4>{title}</h4>
      {children && <div class="empty__body">{children}</div>}
    </div>
  );
}

export function Callout({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error' | 'ok'; children: ComponentChildren }) {
  return (
    <div class={`callout callout--${kind}`}>
      <Icon name={kind === 'info' ? 'info' : kind === 'ok' ? 'check' : 'alert'} size={16} />
      <div>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ list reorder */

/** HTML5 drag & drop reorder; rows become draggable only while their grip is pressed (so inputs stay selectable). */
export function useReorder(onMove: (from: number, to: number) => void) {
  const [armed, setArmed] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return {
    rowProps: (i: number) => ({
      draggable: armed === i,
      'data-dragging': dragging === i ? '' : undefined,
      'data-over': over === i && dragging !== null && dragging !== i ? (dragging < i ? 'below' : 'above') : undefined,
      onDragStart: (e: DragEvent) => {
        setDragging(i);
        e.dataTransfer?.setData('text/plain', String(i));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      },
      onDragOver: (e: DragEvent) => {
        if (dragging === null) return;
        e.preventDefault();
        if (over !== i) setOver(i);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        if (dragging !== null && dragging !== i) onMove(dragging, i);
        setDragging(null);
        setOver(null);
        setArmed(null);
      },
      onDragEnd: () => {
        setDragging(null);
        setOver(null);
        setArmed(null);
      },
    }),
    handleProps: (i: number) => ({
      onPointerDown: () => setArmed(i),
      onPointerUp: () => setArmed(null),
    }),
  };
}

export function ReorderButtons({ index, count, onMove }: { index: number; count: number; onMove: (from: number, to: number) => void }) {
  return (
    <div class="reorder">
      <button type="button" class="icon-btn" disabled={index === 0} onClick={() => onMove(index, index - 1)} aria-label={t('Subir')} title={t('Subir')}>
        <Icon name="up" size={14} />
      </button>
      <button type="button" class="icon-btn" disabled={index === count - 1} onClick={() => onMove(index, index + 1)} aria-label={t('Bajar')} title={t('Bajar')}>
        <Icon name="down" size={14} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ v2 helpers */

let scopeScreenName = '';
/** Set by the App so scope badges can say which screen is being edited. */
export const setScopeScreenName = (n: string) => void (scopeScreenName = n);

export function ScopeBadge({ scope }: { scope: 'screen' | 'global' }) {
  return scope === 'screen' ? (
    <span class="scope scope--screen" title={t('Este ajuste solo afecta a la pantalla que estás editando')}>
      <Icon name="monitor" size={11} />
      {scopeScreenName ? t('Solo {name}', { name: scopeScreenName }) : t('Solo esta pantalla')}
    </span>
  ) : (
    <span class="scope scope--global" title={t('Compartido por todas las pantallas')}>
      <Icon name="globe" size={11} />
      {t('Todas las pantallas')}
    </span>
  );
}

/**
 * Generic modal dialog (forms, editors). Esc / backdrop click / ✕ close it; with `dirty` they ask first
 * so a stray tap doesn't throw the form away. Escape that closes a popover or the confirm is ignored.
 */
export function Modal(props: {
  title: ComponentChildren;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  /** 'full': near the whole window (the screen builder), edge to edge on a phone */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  icon?: IconName;
  /** the form differs from what it was opened with */
  dirty?: boolean;
  /** what the "discard?" question says (default: the form's text) */
  discard?: { title: string; body: string };
  /** false: do not focus the first field on open (a guide to read first; on a phone the keyboard would cover it) */
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const asking = useRef(false);
  const requestClose = async () => {
    if (asking.current) return;
    if (live.current.dirty) {
      asking.current = true;
      const q = live.current.discard ?? { title: t('¿Descartar los cambios?'), body: t('Lo que has escrito en este formulario se perderá.') };
      const ok = await confirmDialog({ title: q.title, body: q.body, confirm: t('Descartar'), danger: true });
      asking.current = false;
      if (!ok) return;
    }
    live.current.onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.stopPropagation();
        void requestClose();
      }
    };
    document.addEventListener('keydown', onKey);
    if (props.autoFocus !== false) ref.current?.querySelector<HTMLElement>('input:not([type=checkbox]):not([type=radio]), textarea, select')?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div class="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && void requestClose()}>
      <div class={`modal modal--form modal--${props.size ?? 'md'}`} role="dialog" aria-modal="true" ref={ref}>
        <header class="modal__head">
          {props.icon && (
            <span class="card__icon">
              <Icon name={props.icon} size={18} />
            </span>
          )}
          <h3>{props.title}</h3>
          <button type="button" class="icon-btn" onClick={() => void requestClose()} aria-label={t('Cerrar')}>
            <Icon name="x" size={16} />
          </button>
        </header>
        <div class="modal__scroll">{props.children}</div>
        {props.footer && <div class="modal__actions modal__actions--bar">{props.footer}</div>}
      </div>
    </div>
  );
}

/** Weekday toggles (0 = Sunday … 6), shown starting on Monday. */
export function WeekdayPicker({ value, onChange, labels }: { value: number[]; onChange: (v: number[]) => void; labels: string[] }) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div class="wd-picker" role="group">
      {order.map((d) => {
        const on = value.includes(d);
        return (
          <button
            type="button"
            class={on ? 'is-on' : ''}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b))}
          >
            {labels[d]}
          </button>
        );
      })}
    </div>
  );
}

/** Small colored dot + label "pill" used in lists. */
export function Tag({ color, children, title }: { color?: string | null; children: ComponentChildren; title?: string }) {
  return (
    <span class="tag" title={title} style={color ? ({ '--tag': color } as any) : undefined}>
      {children}
    </span>
  );
}

/** Text search input with icon + clear button. */
export function SearchInput({ value, onValue, placeholder }: { value: string; onValue: (v: string) => void; placeholder?: string }) {
  return (
    <div class="search-input">
      <Icon name="search" size={15} />
      <input class="input input--sm" value={value} placeholder={placeholder} onInput={(e) => onValue(e.currentTarget.value)} />
      {value && (
        <button type="button" class="icon-btn" onClick={() => onValue('')} aria-label={t('Borrar')}>
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  );
}
