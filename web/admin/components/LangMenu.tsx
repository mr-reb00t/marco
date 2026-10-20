import { useEffect, useRef, useState } from 'preact/hooks';
import { LANG_NAMES, LANGS } from '../../shared/i18n';
import type { Lang } from '../../shared/types';
import { Icon } from './icons';

/**
 * Language dropdown: a small button with the current language's own name that opens a menu with every language,
 * the current one checked. Used in the sidebar and in the setup wizard. Menu pattern: Enter, Space or the arrows
 * open it, the arrows and Home/End move, a letter jumps to the language that starts with it, Escape closes it.
 */
export function LangMenu(props: {
  value: Lang;
  onChange: (l: Lang) => void;
  /** what the button and the menu are called ("Idioma del panel") */
  label: string;
  /** 'compact' for bars, 'field' for a full-width button inside a form */
  variant?: 'compact' | 'field';
  /** open above the button (the sidebar's foot is at the bottom of the screen) */
  up?: boolean;
  /** which edge the menu lines up with (default: start) */
  align?: 'start' | 'end';
  /** a second, quieter line per language ("Hola", "Hello"…) */
  detail?: Partial<Record<Lang, string>>;
  /** gets the focus when the wizard step opens */
  autofocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const variant = props.variant ?? 'compact';
  const items = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];

  useEffect(() => {
    if (!open) return;
    (items().find((b) => b.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus({ preventScroll: true });
    // a phone: the whole menu in view, not cut by the bottom of the screen
    ref.current?.querySelector('[role="menu"]')?.scrollIntoView?.({ block: 'nearest' });
    const onDoc = (e: Event) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', onDoc, true);
    return () => document.removeEventListener('pointerdown', onDoc, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    btn.current?.focus({ preventScroll: true });
  };
  const choose = (l: Lang) => {
    close();
    if (l !== props.value) props.onChange(l);
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => list[(n + list.length) % list.length]?.focus();
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') return setOpen(false);
    else if (e.key.length === 1 && /\p{L}/u.test(e.key)) {
      const k = e.key.toLocaleLowerCase();
      const order = [...list.slice(i + 1), ...list.slice(0, i + 1)];
      order.find((b) => (b.textContent ?? '').trim().toLocaleLowerCase().startsWith(k))?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onBtnKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const cur = props.value;
  return (
    <div
      class={`lang-menu lang-menu--${variant} ${props.up ? 'lang-menu--up' : ''} ${props.align === 'end' ? 'lang-menu--end' : ''} ${open ? 'is-open' : ''}`}
      ref={ref}
    >
      <button
        type="button"
        ref={btn}
        class="lang-menu__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${props.label}: ${LANG_NAMES[cur]}`}
        title={props.label}
        onClick={() => setOpen(!open)}
        onKeyDown={onBtnKey}
        {...(props.autofocus ? { 'data-autofocus': true } : {})}
      >
        <Icon name="globe" size={variant === 'field' ? 18 : 15} class="lang-menu__globe" />
        <span class="lang-menu__cur" lang={cur}>
          {LANG_NAMES[cur]}
          {variant === 'field' && props.detail?.[cur] && <span class="lang-menu__detail">{props.detail[cur]}</span>}
        </span>
        <Icon name="down" size={13} class="lang-menu__chev" />
      </button>
      {open && (
        <div class="lang-menu__menu" role="menu" aria-label={props.label} onKeyDown={onMenuKey}>
          {LANGS.map((l) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={l === cur}
              tabIndex={-1}
              lang={l}
              class={`lang-menu__item ${l === cur ? 'is-active' : ''}`}
              onClick={() => choose(l)}
            >
              <span class="lang-menu__name">{LANG_NAMES[l]}</span>
              {props.detail?.[l] && <span class="lang-menu__detail">{props.detail[l]}</span>}
              <Icon name="check" size={15} class="lang-menu__check" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
