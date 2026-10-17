import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './components/icons';
import { t } from './i18n';
import { draftWidgetPreviews } from './livePreview';
import { postDraftWeather } from './weatherPreview';

/** Tested widget copies already read as Blobs (previewUrl → Blob), so a draft change does not read them again. */
const widgetBlobs = new Map<string, Promise<Blob | null>>();
const widgetBlob = (url: string) => {
  let p = widgetBlobs.get(url);
  if (!p) {
    p = fetch(url, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b && b.type.startsWith('image/') ? b : null))
      .catch(() => null);
    widgetBlobs.set(url, p);
  }
  return p;
};

/**
 * Live, scaled-down preview of a screen in an iframe. Reloaded whenever `reloadKey` changes.
 * `url` is the preview address (displayLinks.ts useScreenUrl with preview: the display then neither registers as a
 * connected screen nor writes its storage), `openUrl` the same screen for a new tab; null while it is not known yet.
 * `focus` (the widget preview of the Widgets page, `url` with widgetOnly=1): the id of the one widget `live` places
 * on the screen. The display says where it is and what it draws ('marco:preview-focus', passed on to `onFocus`) and
 * the frame shows just that box; `reload` changes when a test asks the display to load it again. `title`, `tag`,
 * `extra` (a row under the bar) and `note` (above the hint) dress the panel for that use.
 */
export function Preview({ reloadKey, portrait, onClose, variant, saved, url, openUrl, screenName, choices, chosen, onChoose, hint, live, focus = null, onFocus, reload = 0, title, tag, extra, note }: { reloadKey: number; portrait: boolean; onClose?: () => void; variant: 'side' | 'sheet'; saved: boolean; url: string | null; openUrl: string | null; screenName?: string; choices?: { value: string; label: string }[]; chosen?: string; onChoose?: (v: string) => void; hint?: string; live?: unknown; focus?: string | null; onFocus?: (info: { mode: string | null; cramped: boolean; room: { w: number; h: number } | null }) => void; reload?: number; title?: string; tag?: string; extra?: ComponentChildren; note?: ComponentChildren }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [orient, setOrient] = useState<'land' | 'port'>(portrait ? 'port' : 'land');
  useEffect(() => setOrient(portrait ? 'port' : 'land'), [portrait]);
  useEffect(() => setLoaded(false), [reloadKey, orient, url]);
  // unsaved settings (null = none): sent again whenever they change and each time the page in the frame loads
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (live === undefined || !loaded || !url) return;
    try {
      const origin = new URL(url, location.href).origin;
      frame.current?.contentWindow?.postMessage({ type: 'marco:preview-draft', config: live, focus }, origin);
      // a screen's place or a weather card's not saved yet (#11)
      void postDraftWeather(frame.current?.contentWindow, origin, live);
      // Marco Cloud: unsaved widgets show the copy their last test made (the server only serves saved ones)
      for (const pv of live ? draftWidgetPreviews() : []) {
        void widgetBlob(pv.url).then((blob) => {
          if (blob) frame.current?.contentWindow?.postMessage({ type: 'marco:preview-widget', id: pv.id, v: pv.v, blob }, origin);
        });
      }
    } catch { /* the frame went away */ }
  }, [live, loaded, url, focus]);
  // a test of the widget: the display loads it again
  const lastReload = useRef(reload);
  useEffect(() => {
    if (reload === lastReload.current) return;
    lastReload.current = reload;
    if (!focus || !loaded || !url) return;
    try {
      frame.current?.contentWindow?.postMessage({ type: 'marco:preview-reload', id: focus }, new URL(url, location.href).origin);
    } catch { /* the frame went away */ }
  }, [reload, focus, loaded, url]);
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  // where the focused widget is on the screen (null: nowhere yet, the whole screen is shown)
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // the room it has there (the side column, its corner's box): outlined, so a corner and the side column look apart
  const [room, setRoom] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    setRect(null);
    setRoom(null);
  }, [focus, reloadKey, orient, url]);
  useEffect(() => {
    if (!focus) return;
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.type !== 'marco:preview-focus' || e.data.id !== focus) return;
      const ok = (r: unknown): r is { x: number; y: number; w: number; h: number } =>
        !!r && typeof r === 'object' && ['x', 'y', 'w', 'h'].every((k) => typeof (r as Record<string, unknown>)[k] === 'number' && Number.isFinite((r as Record<string, number>)[k]));
      const r = ok(e.data.rect) ? e.data.rect : null;
      const rm = r && ok(e.data.room) ? e.data.room : null;
      setRect(r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null);
      setRoom(rm ? { x: rm.x, y: rm.y, w: rm.w, h: rm.h } : null);
      onFocusRef.current?.({ mode: typeof e.data.mode === 'string' ? e.data.mode : null, cramped: e.data.cramped === true, room: rm ? { w: rm.w, h: rm.h } : null });
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [focus]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const W = orient === 'land' ? 1920 : 1080;
  const H = orient === 'land' ? 1080 : 1920;
  // In portrait, cap the height so it fits in the column.
  // the widget preview sits under the screen preview: less height
  const maxH = window.innerHeight * (focus ? (room && room.h > room.w ? 0.55 : 0.42) : variant === 'sheet' ? 0.7 : 0.62);
  // the part of the screen in view: all of it, or the focused widget with a margin of its backdrop
  const pad = 0.025 * Math.min(W, H);
  // (with the room it has there)
  const area = rect && room
    ? { x: Math.min(rect.x, room.x), y: Math.min(rect.y, room.y), r: Math.max(rect.x + rect.w, room.x + room.w), b: Math.max(rect.y + rect.h, room.y + room.h) }
    : rect ? { x: rect.x, y: rect.y, r: rect.x + rect.w, b: rect.y + rect.h } : null;
  const crop = focus && area
    ? (() => {
        const x0 = Math.max(0, area.x - pad);
        const y0 = Math.max(0, area.y - pad);
        return { x: x0, y: y0, w: Math.min(W, area.r + pad) - x0, h: Math.min(H, area.b + pad) - y0 };
      })()
    : { x: 0, y: 0, w: W, h: H };
  const zoomed = crop.w < W || crop.h < H;
  // one scale for every size of a widget (the card's width is 42% of the screen's), so a small one looks small;
  // never larger than on the TV itself
  const across = focus ? Math.max(crop.w, 0.42 * W) : crop.w;
  const scale = Math.min(w / across, orient === 'port' || zoomed ? maxH / crop.h : Infinity, 1) || 0.1;
  return (
    <div class={`preview preview--${variant} ${focus ? 'preview--widget' : ''}`}>
      <div class="preview__bar">
        <span class="live-dot" />
        <strong>
          {title ?? t('Vista previa')}
          {!choices && screenName && <span class="preview__scr"> · {screenName}</span>}
          {tag && <span class="preview__tag">{tag}</span>}
        </strong>
        {choices && (
          <select class="preview__pick" value={chosen} aria-label={t('Qué mostrar')} onChange={(e) => onChoose?.(e.currentTarget.value)}>
            {choices.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <div class="preview__tools">
          {!focus && (
          <>
          <button type="button" class={`icon-btn ${orient === 'land' ? 'is-active' : ''}`} onClick={() => setOrient('land')} title={t('Horizontal')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="6" width="18" height="12" rx="2" />
            </svg>
          </button>
          <button type="button" class={`icon-btn ${orient === 'port' ? 'is-active' : ''}`} onClick={() => setOrient('port')} title={t('Vertical')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="6" y="3" width="12" height="18" rx="2" />
            </svg>
          </button>
          </>
          )}
          {/* the widget preview is not what the screen shows: no link to open it */}
          {saved && openUrl && !focus && (
            <a class="icon-btn" href={openUrl} target="_blank" rel="noopener" title={t('Abrir pantalla')}>
              <Icon name="external" size={15} />
            </a>
          )}
          {onClose && (
            <button type="button" class="icon-btn" onClick={onClose} title={t('Cerrar')}>
              <Icon name="x" size={15} />
            </button>
          )}
        </div>
      </div>
      {extra && <div class="preview__extra">{extra}</div>}
      <div class="preview__frame-wrap" ref={box}>
        <div class={`preview__frame ${zoomed ? 'is-zoomed' : ''}`} style={{ width: `${crop.w * scale}px`, height: `${crop.h * scale}px` }}>
          {!saved ? (
            <div class="preview__unsaved muted small">{t('Guarda para previsualizar esta pantalla')}</div>
          ) : w > 0 && url && (
            <iframe
              key={`${reloadKey}-${orient}-${url}`}
              ref={frame}
              src={`${url}${url.includes('?') ? '&' : '?'}v=${reloadKey}`}
              title={t('Vista previa')}
              loading="lazy"
              tabIndex={-1}
              style={{ width: `${W}px`, height: `${H}px`, transform: `translate(${-crop.x * scale}px, ${-crop.y * scale}px) scale(${scale})` }}
              onLoad={() => setLoaded(true)}
            />
          )}
          {focus && room && loaded && (
            <div
              class="preview__room"
              aria-hidden="true"
              style={{ left: `${(room.x - crop.x) * scale}px`, top: `${(room.y - crop.y) * scale}px`, width: `${room.w * scale}px`, height: `${room.h * scale}px` }}
            />
          )}
          {saved && !loaded && <div class="preview__loading shimmer" />}
        </div>
      </div>
      {note}
      <p class="preview__hint muted small">{hint ?? t('Se recarga al guardar. Los cambios sin guardar no aparecen aquí.')}</p>
    </div>
  );
}
