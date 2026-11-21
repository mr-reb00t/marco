import { useEffect, useRef, useState } from 'preact/hooks';
import { coverPosition, freeBand, hasFocus, type PhotoFrame } from '../../shared/focus';
import type { AdminPhoto, AppConfig, DisplayInfo, PhotoConflictPolicy } from '../../shared/types';
import { api, ApiError, uploadPhotos, uploadThumb } from '../api';
import { confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { ConflictDialog, FocusEditor, type ConflictItem } from '../components/PhotoDialogs';
import { Button, Callout, Card, Empty, PageHeader, Segmented } from '../components/ui';
import { limit, runtime } from '../caps';
import { locale, t } from '../i18n';
import { isJpegName, jpgName, looksLikeImage, MAX_UPLOAD_BYTES, optimizePhoto, PhotoError, photoDateTaken, TARGET_SIDE } from '../photoTools';
import { formatBytes } from '../util';
import type { SectionProps } from './common';

const SERVER_TYPES = /\.(jpe?g|png|webp)$/i;
/** Heavier than this (even at ≤ 2560 px) → offered for optimization. */
const HEAVY = 1.6 * 1024 * 1024;

type Status = 'waiting' | 'heic' | 'optimizing' | 'uploading' | 'done' | 'skipped' | 'error';
interface QueueItem {
  id: number;
  name: string;
  status: Status;
  pct: number;
  before?: number;
  after?: number;
  note?: string;
  error?: string;
  thumb?: string;
}
interface Queue {
  kind: 'upload' | 'existing';
  items: QueueItem[];
  running: boolean;
}

/** What an existing gallery photo still needs: thumbnail, focal point, or a lighter / upright JPEG. */
export function needsWork(p: AdminPhoto): boolean {
  const processed = p.hasThumb && hasFocus(p) && isJpegName(p.file) && !!p.w && Math.max(p.w, p.h || 0) <= TARGET_SIDE;
  // A processed photo that re-encoding couldn't make lighter (detailed 2560 px JPEGs) is done; don't offer it again.
  return !processed || (p.size > HEAVY && !(p.hasThumb && hasFocus(p)));
}

/** Servers that run on Workers (Marco Cloud) store photos with a plan: one photo per request, always optimized. */
const onWorkers = () => runtime() === 'workers';

function errorText(e: unknown): string {
  if (e instanceof PhotoError) {
    if (e.code === 'too-big') return t('Supera el límite de 100 MB');
    if (e.code === 'not-image') return t('No es una imagen');
    if (e.code === 'heic') return t('No se pudo convertir la foto HEIC. Expórtala como JPG y vuelve a intentarlo.');
    return t('El navegador no puede leer esta imagen. Guárdala como JPG y vuelve a intentarlo.');
  }
  if (e instanceof ApiError) {
    if (e.code === 'photo_quota') {
      const b = (e.body ?? {}) as { reason?: string; limit?: number; maxPhotos?: number };
      if (b.reason === 'count') return t('Has llegado al máximo de {n} fotos. Borra alguna para subir más.', { n: b.maxPhotos ?? limit('photos') ?? '' });
      return t('La galería está llena ({max}). Borra alguna foto para subir más.', { max: formatBytes(b.limit ?? limit('totalPhotoBytes') ?? 0) });
    }
    if (e.status === 413) {
      const each = limit('photoBytes');
      return each != null ? t('Ocupa más de {size} incluso optimizada.', { size: formatBytes(each) }) : t('Supera el límite de 100 MB');
    }
    if (e.status === 429 && onWorkers()) return t('Demasiadas subidas seguidas. Espera un minuto y vuelve a intentarlo.');
    if (e.status === 415) return t('Formato no admitido (usa JPG, PNG o WebP)');
    if (e.status === 0) return t('Sin conexión con el servidor');
    return e.message;
  }
  return (e as Error)?.message || String(e);
}

let seq = 0;

/**
 * Photo panel framing for the editor preview: what a display of this screen measured (aspect + the bands the
 * clock and the weather card cover), else an estimate from the layout.
 */
function pickFrame(cfg: AppConfig, displays: DisplayInfo[]): { frame: PhotoFrame; note: string } {
  const withFrame = displays
    .filter((d) => d.photoFrame)
    .sort((a, b) => Number(b.screenId === cfg.screenId) - Number(a.screenId === cfg.screenId) || Number(b.connected) - Number(a.connected) || b.lastSeen.localeCompare(a.lastSeen));
  const d = withFrame[0];
  if (d?.photoFrame) {
    const res = d.viewport ? ` · ${d.viewport.w}×${d.viewport.h}` : '';
    return { frame: d.photoFrame, note: t('medido en «{name}»', { name: d.screenName || d.screenSlug || d.clientId }) + res };
  }
  const preset = cfg.layout?.preset;
  const side = preset === 'bigCalendar' || preset === 'agenda' || preset === 'leftRight';
  const aspect = side ? ((cfg.layout?.sideWidth || 0.36) * 16) / 9 : 16 / 9;
  const blocks: [number, number][] = side ? [[0.03, 0.25]] : [[0.04, 0.2]];
  if (cfg.weather?.enabled !== false) blocks.push(side ? [0.45, 0.97] : [0.72, 0.95]);
  const band = freeBand(blocks);
  return { frame: { aspect, targetY: band.target, freeTop: band.top, freeBottom: band.bottom, blocks }, note: t('aproximado: abre la pantalla para medirlo') };
}

export function PhotosSection({ cfg, set }: SectionProps) {
  const [photos, setPhotos] = useState<AdminPhoto[] | null>(null);
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [conflicts, setConflicts] = useState<{ items: ConflictItem[]; resolve: (c: Record<string, PhotoConflictPolicy> | null) => void } | null>(null);
  const [editing, setEditing] = useState<AdminPhoto | null>(null);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [filter, setFilter] = useState<'all' | 'shown' | 'hidden'>('all');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  const busy = !!queue?.running;
  const cloud = onWorkers();
  const maxTotal = limit('totalPhotoBytes');
  const maxCount = limit('photos');
  const maxEach = limit('photoBytes');

  const load = async () => {
    try {
      const list = await api.photos();
      list.sort((a, b) => +new Date(b.mtime) - +new Date(a.mtime));
      setPhotos(list);
      setErr('');
      return list;
    } catch (e) {
      setErr((e as ApiError).message);
      setPhotos([]);
      return [];
    }
  };
  useEffect(() => {
    load();
    api.displays().then((r) => setDisplays(r.displays), () => {});
    return () => urls.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const clearQueue = () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
    setQueue(null);
  };
  const patch = (id: number, p: Partial<QueueItem>) =>
    setQueue((q) => q && { ...q, items: q.items.map((i) => (i.id === id ? { ...i, ...p } : i)) });
  const thumbUrl = (b: Blob) => {
    const u = URL.createObjectURL(b);
    urls.current.push(u);
    return u;
  };

  /* ---------------------------------------------------------------- upload new files */

  // Synchronous guard: a second selection while names are being checked must not start a parallel batch.
  const lock = useRef(false);
  const withLock = (fn: () => Promise<void>) => async () => {
    if (lock.current) return;
    lock.current = true;
    try {
      await fn();
    } finally {
      lock.current = false;
    }
  };

  const handleFiles = (list: FileList | File[]) => withLock(() => uploadFiles(Array.from(list)))();
  const uploadFiles = async (list: File[]) => {
    const files = Array.from(list);
    if (!files.length) return;
    // A plan with a storage limit: say so before optimizing anything when the gallery is already full.
    const usedNow = (photos ?? []).reduce((s, p) => s + (p.size || 0), 0);
    if (maxTotal != null && usedNow >= maxTotal) {
      toast(t('La galería está llena ({max}). Borra alguna foto para subir más.', { max: formatBytes(maxTotal) }), 'error', 9000);
      return;
    }
    if (maxCount != null && (photos?.length ?? 0) >= maxCount) {
      toast(t('Has llegado al máximo de {n} fotos. Borra alguna para subir más.', { n: maxCount }), 'error', 9000);
      return;
    }
    clearQueue();
    const items: (QueueItem & { file: File; target: string })[] = files.map((f) => ({
      id: ++seq, name: f.name, file: f, target: jpgName(f.name), status: 'waiting', pct: 0, before: f.size,
    }));
    // Rejected up front: say which and why.
    const rejected: string[] = [];
    for (const it of items) {
      if (it.file.size > MAX_UPLOAD_BYTES) Object.assign(it, { status: 'error', error: t('Supera el límite de 100 MB') });
      else if (!looksLikeImage(it.file)) Object.assign(it, { status: 'error', error: t('No es una imagen') });
      if (it.status === 'error') rejected.push(`${it.name} (${it.error})`);
    }
    if (rejected.length) {
      toast(
        t('{n} archivos rechazados: {list}', { n: rejected.length, list: rejected.slice(0, 3).join(', ') + (rejected.length > 3 ? '…' : '') }),
        'error',
        9000
      );
    }
    const ok = items.filter((i) => i.status !== 'error');
    if (!ok.length) {
      setQueue({ kind: 'upload', items, running: false });
      return;
    }

    // Duplicate names: ask before uploading (the server's own sanitization decides what "same name" means).
    const policies: Record<number, PhotoConflictPolicy> = {};
    try {
      const { results } = await api.checkPhotoNames(ok.map((i) => i.target));
      results.forEach((r, k) => (ok[k].target = r.sanitized));
      const clash = results.map((r, k) => ({ r, it: ok[k] })).filter((x) => x.r.exists);
      if (clash.length) {
        const byName = new Map((photos ?? []).map((p) => [p.file, p]));
        const choice = await new Promise<Record<string, PhotoConflictPolicy> | null>((resolve) =>
          setConflicts({
            items: clash.map(({ r, it }) => ({
              key: String(it.id), original: it.name, size: it.file.size, target: r.sanitized, renamed: r.renamed, existing: byName.get(r.sanitized),
            })),
            resolve,
          })
        );
        setConflicts(null);
        if (!choice) return;
        for (const [k, v] of Object.entries(choice)) policies[Number(k)] = v;
      }
    } catch (e) {
      toast(`${t('No se pudo comprobar si las fotos ya existen')}: ${errorText(e)}`, 'error');
      return;
    }

    setQueue({ kind: 'upload', items, running: true });
    let uploaded = 0, failed = 0, before = 0, after = 0, noRoom = 0;
    // Room left in the plan (the server checks it again, atomically).
    let room = maxTotal != null ? maxTotal - usedNow : Infinity;
    for (const it of ok) {
      const policy = policies[it.id] ?? 'rename';
      if (policy === 'skip') {
        patch(it.id, { status: 'skipped', note: t('Omitida: ya existe') });
        continue;
      }
      try {
        let up: { blob: Blob; name: string; thumb?: Blob; focusX?: number; focusY?: number; takenAt?: string };
        let note = '';
        const takenAt = (await photoDateTaken(it.file)) || undefined;
        try {
          const o = await optimizePhoto(it.file, { strip: cloud, onStage: (s) => patch(it.id, { status: s, pct: s === 'heic' ? 0.1 : 0.2 }) });
          up = { ...o, takenAt };
          patch(it.id, { thumb: thumbUrl(o.thumb), after: o.after });
        } catch (e) {
          // A JPG/PNG/WebP this browser can't decode still goes up as it is (the server accepts it).
          // On Workers every photo is optimized (metadata such as the location must not be stored).
          if (!cloud && e instanceof PhotoError && e.code === 'decode' && SERVER_TYPES.test(it.file.name) && /^image\/(jpeg|png|webp)$/.test(it.file.type)) {
            up = { blob: it.file, name: it.file.name, takenAt };
            note = t('subida sin optimizar');
          } else throw e;
        }
        if (maxEach != null && up.blob.size > maxEach) {
          failed++;
          patch(it.id, { status: 'error', error: t('Ocupa más de {size} incluso optimizada.', { size: formatBytes(maxEach) }) });
          continue;
        }
        if (policy !== 'replace' && up.blob.size > room) {
          noRoom++;
          patch(it.id, { status: 'error', error: t('No cabe: quedan {free} libres en la galería.', { free: formatBytes(Math.max(0, room)) }) });
          continue;
        }
        patch(it.id, { status: 'uploading', pct: 0.4 });
        const res = await uploadPhotos([up], up.name === jpgName(it.file.name) ? policy : 'rename', (fr) => patch(it.id, { pct: 0.4 + fr * 0.6 }));
        const f = res.files[0];
        if (!f) {
          patch(it.id, { status: 'skipped', note: t('Omitida: ya existe') });
          continue;
        }
        uploaded++;
        if (f.status !== 'replaced') room -= f.size;
        before += it.file.size;
        after += up.blob.size;
        const extra = f.status === 'replaced' ? t('reemplazada') : f.status === 'renamed' ? t('guardada como {name}', { name: f.file }) : '';
        patch(it.id, { status: 'done', pct: 1, after: up.blob.size, note: [note, extra].filter(Boolean).join(' · ') });
      } catch (e) {
        failed++;
        patch(it.id, { status: 'error', error: errorText(e) });
      }
    }
    setQueue((q) => q && { ...q, running: false });
    if (uploaded) toast(t('{n} fotos subidas · {before} → {after}', { n: uploaded, before: formatBytes(before), after: formatBytes(after) }));
    if (failed) toast(t('{n} archivos no se pudieron subir', { n: failed }), 'error');
    if (noRoom) toast(t('{n} fotos no caben en la galería', { n: noRoom }), 'error', 9000);
    load();
  };

  /* ---------------------------------------------------------------- optimize what's already there */

  // The progress card sits at the top of the page; bring it into view when a batch starts (the buttons that
  // start one are further down, next to the photos).
  const queueRef = useRef<HTMLDivElement>(null);
  const queueKey = queue ? `${queue.kind}:${queue.items[0]?.id ?? 0}` : '';
  useEffect(() => {
    if (queueKey) requestAnimationFrame(() => queueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [queueKey]);

  const optimizeExisting = withLock(async () => {
    const todo = (photos ?? []).filter(needsWork);
    if (!todo.length) return;
    const ok = await confirmDialog({
      title: t('Optimizar y encuadrar fotos existentes'),
      body: t(
        'Se procesarán {n} fotos en este navegador, una a una: se reducen a 2560 px como máximo, se crea una miniatura y se calcula el punto de foco (los encuadres que ya hayas elegido se conservan). Puede tardar un par de minutos; deja esta página abierta.',
        { n: todo.length }
      ),
      confirm: t('Optimizar {n} fotos', { n: todo.length }),
    });
    if (!ok) return;
    clearQueue();
    const items: QueueItem[] = todo.map((p) => ({ id: ++seq, name: p.file, status: 'waiting', pct: 0, before: p.size }));
    setQueue({ kind: 'existing', items, running: true });
    let done = 0, failed = 0, before = 0, after = 0;
    for (let k = 0; k < todo.length; k++) {
      const p = todo[k];
      const id = items[k].id;
      try {
        patch(id, { status: 'optimizing', pct: 0.05 });
        const res = await fetch(p.url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], p.file, { type: blob.type || 'image/jpeg' });
        const keepFocus = hasFocus(p) ? { focusX: p.focusX!, focusY: p.focusY! } : undefined;
        const o = await optimizePhoto(file, { keepFocus, strip: cloud, onStage: (s) => patch(id, { status: s, pct: 0.2 }) });
        patch(id, { thumb: thumbUrl(o.thumb), status: 'uploading', pct: 0.5 });
        let note = '';
        if (o.kept && jpgName(p.file) === p.file) {
          // Already a light JPEG: only the thumbnail and the focal point are missing.
          await uploadThumb(p.file, o.thumb);
          if (!hasFocus(p)) await api.setPhotoFocus(p.file, o.focusX, o.focusY);
          note = t('ya estaba optimizada · miniatura y encuadre listos');
        } else if (jpgName(p.file) === p.file) {
          await uploadPhotos([{ ...o, takenAt: p.takenAt }], 'replace', (fr) => patch(id, { pct: 0.5 + fr * 0.5 }));
        } else {
          // PNG / WebP → new .jpg next to it, then the old file goes.
          const r = await uploadPhotos([{ ...o, takenAt: p.takenAt }], 'rename', (fr) => patch(id, { pct: 0.5 + fr * 0.45 }));
          if (r.files[0] && p.hidden) await api.setPhotoHidden(r.files[0].file, true);
          if (r.files[0]) await api.deletePhoto(p.file);
          note = t('convertida a {name}', { name: r.files[0]?.file ?? o.name });
        }
        done++;
        before += p.size;
        after += o.kept ? p.size : o.after;
        patch(id, { status: 'done', pct: 1, after: o.kept ? p.size : o.after, note });
      } catch (e) {
        failed++;
        patch(id, { status: 'error', error: errorText(e) });
      }
    }
    setQueue((q) => q && { ...q, running: false });
    if (done) toast(t('{n} fotos optimizadas · {before} → {after}', { n: done, before: formatBytes(before), after: formatBytes(after) }));
    if (failed) toast(t('{n} fotos no se pudieron optimizar', { n: failed }), 'error');
    load();
  });

  const remove = async (p: AdminPhoto) => {
    const ok = await confirmDialog({ title: t('Eliminar foto'), body: p.file, confirm: t('Eliminar'), danger: true });
    if (!ok) return;
    try {
      await api.deletePhoto(p.file);
      setPhotos((l) => l?.filter((x) => x.file !== p.file) ?? null);
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  /* ---------------------------------------------------------------- rotation (shown / hidden) */

  const markHidden = (files: string[], hidden: boolean) => {
    const set = new Set(files);
    setPhotos((l) => l?.map((x) => (set.has(x.file) ? { ...x, hidden } : x)) ?? null);
  };
  const toggleHidden = async (p: AdminPhoto) => {
    const hidden = !p.hidden;
    markHidden([p.file], hidden); // optimistic
    try {
      await api.setPhotoHidden(p.file, hidden);
      toast(hidden ? t('Oculta: ya no saldrá en pantalla') : t('En rotación: volverá a salir en pantalla'));
    } catch (e) {
      markHidden([p.file], !hidden);
      toast((e as ApiError).message, 'error');
    }
  };
  const bulkHidden = async (hidden: boolean) => {
    const files = [...selected].filter((f) => photos?.some((p) => p.file === f && !!p.hidden !== hidden));
    if (!files.length) {
      toast(hidden ? t('Las fotos seleccionadas ya están ocultas') : t('Las fotos seleccionadas ya están en rotación'));
      return;
    }
    setBulkBusy(true);
    try {
      const r = await api.setPhotosHidden(files, hidden);
      markHidden(r.updated, hidden);
      toast(hidden ? t('{n} fotos ocultas', { n: r.updated.length }) : t('{n} fotos vuelven a la rotación', { n: r.updated.length }));
      setSelected(new Set());
      setSelecting(false);
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBulkBusy(false);
    }
  };
  const toggleSelect = (file: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(file)) n.delete(file);
      else n.add(file);
      return n;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const total = photos?.reduce((s, p) => s + (p.size || 0), 0) ?? 0;
  const hiddenCount = (photos ?? []).filter((p) => p.hidden).length;
  const shownCount = (photos?.length ?? 0) - hiddenCount;
  const visible = (photos ?? []).filter((p) => (filter === 'all' ? true : filter === 'hidden' ? !!p.hidden : !p.hidden));
  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.file));
  const pending = (photos ?? []).filter(needsWork).length;
  const tileAspect = 16 / 10;

  return (
    <>
      <PageHeader
        title={t('Galería')}
        desc={cloud ? t('Tus fotos para el fondo de pantalla. Se guardan en tu cuenta de Marco.') : t('Tus fotos para el fondo de pantalla. Se guardan en el propio servidor.')}
      />
      {cfg.background.source === 'stock' && (
        <Callout>
          {t('Ahora mismo el fondo usa fotos de stock.')}{' '}
          <button type="button" class="link-btn" onClick={() => set((d) => void (d.background.source = 'gallery'))}>
            {t('Usar mi galería')}
          </button>{' '}
          ·{' '}
          <button type="button" class="link-btn" onClick={() => set((d) => void (d.background.source = 'mixed'))}>
            {t('Mezclar ambas')}
          </button>
        </Callout>
      )}
      <div
        class={`dropzone ${drag ? 'is-drag' : ''} ${busy ? 'is-busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer?.files?.length && !busy) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !busy && input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && (e.preventDefault(), input.current?.click())}
        role="button"
        tabIndex={0}
        aria-disabled={busy}
      >
        <input
          ref={input}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files;
            if (f?.length) handleFiles(f);
            e.currentTarget.value = '';
          }}
        />
        <span class="dropzone__icon">{busy ? <span class="spinner" /> : <Icon name="upload" size={26} />}</span>
        <strong>{busy ? t('Procesando fotos…') : t('Arrastra fotos aquí o haz clic para elegir')}</strong>
        <span class="muted small">
          {cloud
            ? t('JPG, HEIC, PNG, WebP… · tu navegador las reduce, las convierte y les quita los datos de ubicación antes de subirlas')
            : t('JPG, HEIC, PNG, WebP… · hasta 100 MB cada una · se optimizan en tu navegador antes de subir')}
        </span>
      </div>
      {maxTotal != null && photos !== null && <QuotaBar used={total} max={maxTotal} count={photos.length} maxCount={maxCount} />}

      {queue && <div ref={queueRef}><UploadQueue queue={queue} onClose={clearQueue} /></div>}

      <Card
        title={t('Fotos')}
        icon="photos"
        desc={photos ? t('{n} fotos · {size}', { n: photos.length, size: formatBytes(total) }) : undefined}
        actions={
          <Button size="sm" variant="ghost" icon="refresh" onClick={load}>
            {t('Recargar')}
          </Button>
        }
      >
        {photos && photos.length > 0 && shownCount === 0 && (
          <Callout kind="warn">
            <strong>{t('Todas las fotos están ocultas.')}</strong>{' '}
            {cfg.background.source === 'stock'
              ? t('Ninguna foto de la galería está en rotación.')
              : t('La pantalla usará fotos de stock hasta que vuelvas a mostrar alguna.')}
          </Callout>
        )}
        {pending > 0 && !busy && (
          <div class="photo-todo">
            <span class="photo-todo__icon">
              <Icon name="wand" size={18} />
            </span>
            <div class="photo-todo__text">
              <strong>{t('{n} fotos sin optimizar ni encuadrar', { n: pending })}</strong>
              <span class="muted small">{t('Reducirlas y encuadrarlas hace que la galería cargue rápido y que la pantalla no corte caras.')}</span>
            </div>
            <Button size="sm" variant="primary" icon="wand" onClick={optimizeExisting}>
              {t('Optimizar y encuadrar fotos existentes')}
            </Button>
          </div>
        )}
        {photos === null ? (
          <div class="photo-grid">
            {Array.from({ length: 8 }, () => (
              <div class="photo skeleton" />
            ))}
          </div>
        ) : photos.length === 0 ? (
          <Empty icon="photos" title={err ? t('No se pudo cargar la galería') : t('La galería está vacía')}>
            {err || t('Mientras tanto se usan fotos de stock aleatorias.')}
          </Empty>
        ) : (
          <>
            <div class="photo-bar">
              <div class="photo-bar__count" aria-live="polite">
                <span class={`photo-bar__dot ${shownCount === 0 ? 'is-off' : ''}`} />
                <span>
                  <strong>{t('{shown} de {total} en rotación', { shown: shownCount, total: photos.length })}</strong>
                  {hiddenCount > 0 && <span class="muted"> · {t('{n} ocultas', { n: hiddenCount })}</span>}
                </span>
              </div>
              <div class="photo-bar__tools">
                <Segmented
                  size="sm"
                  value={filter}
                  options={[
                    { value: 'all', label: `${t('Todas')} ${photos.length}` },
                    { value: 'shown', label: `${t('En rotación')} ${shownCount}` },
                    { value: 'hidden', label: `${t('Ocultas')} ${hiddenCount}` },
                  ]}
                  onChange={(v) => setFilter(v)}
                />
                {!selecting && (
                  <Button size="sm" icon="checklist" onClick={() => setSelecting(true)}>
                    {t('Seleccionar')}
                  </Button>
                )}
              </div>
            </div>
            {selecting && (
              <div class="photo-select" role="toolbar" aria-label={t('Selección')}>
                <span class="photo-select__n">{t('{n} seleccionadas', { n: selected.size })}</span>
                <span class="photo-select__links">
                  <button type="button" class="link-btn" disabled={allVisibleSelected} onClick={() => setSelected(new Set([...selected, ...visible.map((p) => p.file)]))}>
                    {t('Seleccionar todo')}
                  </button>
                  <span class="muted">/</span>
                  <button type="button" class="link-btn" disabled={!selected.size} onClick={() => setSelected(new Set())}>
                    {t('ninguna')}
                  </button>
                </span>
                <span class="photo-select__spacer" />
                <Button size="sm" variant="primary" icon="eye" disabled={!selected.size} loading={bulkBusy} onClick={() => bulkHidden(false)}>
                  {t('Mostrar en pantalla')}
                </Button>
                <Button size="sm" icon="eyeOff" disabled={!selected.size || bulkBusy} onClick={() => bulkHidden(true)}>
                  {t('No mostrar')}
                </Button>
                <Button size="sm" variant="ghost" icon="x" onClick={stopSelecting}>
                  {t('Listo')}
                </Button>
              </div>
            )}
            {visible.length === 0 ? (
              <p class="photo-none muted">{filter === 'hidden' ? t('No hay fotos ocultas.') : t('No hay fotos en rotación.')}</p>
            ) : (
              <div class={`photo-grid ${selecting ? 'is-selecting' : ''}`}>
                {visible.map((p) => {
                  const w = p.w || 1600, h = p.h || 1000;
                  const s = Math.min(1, 480 / Math.max(w, h));
                  const sel = selected.has(p.file);
                  return (
                    <figure class={`photo ${p.hidden ? 'is-hidden' : ''} ${sel ? 'is-selected' : ''}`} key={p.file}>
                      <button
                        type="button"
                        class="photo__open"
                        onClick={() => (selecting ? toggleSelect(p.file) : setEditing(p))}
                        title={selecting ? p.file : t('Encuadrar')}
                        aria-label={selecting ? p.file : `${t('Encuadrar')}: ${p.file}`}
                        aria-pressed={selecting ? sel : undefined}
                      >
                        <img
                          src={p.thumbUrl || p.url}
                          alt={p.file}
                          width={Math.round(w * s)}
                          height={Math.round(h * s)}
                          loading="lazy"
                          decoding="async"
                          style={{ objectPosition: coverPosition(w, h, tileAspect, 1, p.focusX, p.focusY) }}
                        />
                      </button>
                      {selecting ? (
                        <span class={`photo__check ${sel ? 'is-on' : ''}`} aria-hidden="true">
                          {sel && <Icon name="check" size={14} />}
                        </span>
                      ) : (
                        hasFocus(p) && !p.hidden && (
                          <span class="photo__badge" title={t('Encuadre guardado')}>
                            <Icon name="target" size={12} />
                          </span>
                        )
                      )}
                      {p.hidden && (
                        <span class="photo__hidden-tag">
                          <Icon name="eyeOff" size={12} />
                          {t('Oculta')}
                        </span>
                      )}
                      <figcaption>
                        <span class="photo__name" title={p.file}>
                          {p.file}
                        </span>
                        <span>
                          {p.w && p.h ? `${p.w}×${p.h} · ` : ''}
                          {formatBytes(p.size)} · {new Date(p.mtime).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}
                        </span>
                      </figcaption>
                      {!selecting && (
                        <div class="photo__actions">
                          <button
                            type="button"
                            class={`photo__act photo__eye ${p.hidden ? 'is-off' : ''}`}
                            aria-pressed={!p.hidden}
                            aria-label={`${p.hidden ? t('Mostrar en pantalla') : t('No mostrar')}: ${p.file}`}
                            title={p.hidden ? t('Oculta · clic para mostrarla en pantalla') : t('En rotación · clic para ocultarla')}
                            onClick={() => toggleHidden(p)}
                          >
                            <Icon name={p.hidden ? 'eyeOff' : 'eye'} size={15} />
                          </button>
                          <button type="button" class="photo__act photo__del" aria-label={t('Eliminar')} title={t('Eliminar')} onClick={() => remove(p)}>
                            <Icon name="trash" size={15} />
                          </button>
                        </div>
                      )}
                    </figure>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Card>
      {conflicts && <ConflictDialog items={conflicts.items} onDone={conflicts.resolve} />}
      {editing && (
        <FocusEditor
          photo={editing}
          {...(() => {
            const f = pickFrame(cfg, displays);
            return { frame: f.frame, panelNote: f.note };
          })()}
          panelLabel={t('Panel de fotos de la pantalla')}
          onClose={() => setEditing(null)}
          onSaved={(np) => {
            setEditing(null);
            setPhotos((l) => l?.map((x) => (x.file === np.file ? np : x)) ?? null);
          }}
        />
      )}
    </>
  );
}

/** Storage used against the plan: "X MB de 200 MB · N fotos". */
function QuotaBar({ used, max, count, maxCount }: { used: number; max: number; count: number; maxCount: number | null }) {
  const frac = max > 0 ? Math.min(1, used / max) : 1;
  const full = used >= max || (maxCount != null && count >= maxCount);
  const low = !full && frac >= 0.9;
  return (
    <div class={`photo-quota ${full ? 'is-full' : low ? 'is-low' : ''}`}>
      <div class="photo-quota__head">
        <strong>{t('Espacio de la galería')}</strong>
        <span class="muted small">
          {t('{used} de {max} · {n} fotos', { used: formatBytes(used), max: formatBytes(max), n: count })}
          {!full && ` · ${t('quedan {free} libres', { free: formatBytes(max - used) })}`}
        </span>
      </div>
      <div class="progress photo-quota__bar" role="progressbar" aria-label={t('Espacio de la galería')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
        <span style={{ transform: `scaleX(${frac})` }} />
      </div>
      {full ? (
        <p class="photo-quota__note small">
          {maxCount != null && count >= maxCount
            ? t('Has llegado al máximo de {n} fotos. Borra alguna para subir más.', { n: maxCount })
            : t('La galería está llena ({max}). Borra alguna foto para subir más.', { max: formatBytes(max) })}
        </p>
      ) : (
        low && <p class="photo-quota__note small">{t('Queda poco espacio. Borra las fotos que ya no uses para subir más.')}</p>
      )}
    </div>
  );
}

function statusText(i: QueueItem): string {
  switch (i.status) {
    case 'waiting':
      return t('En cola');
    case 'heic':
      return t('Convirtiendo HEIC…');
    case 'optimizing':
      return t('Optimizando…');
    case 'uploading':
      return t('Subiendo… {pct}%', { pct: Math.round(((i.pct - 0.4) / 0.6) * 100) });
    case 'skipped':
      return i.note || t('Omitida');
    case 'error':
      return i.error || t('Error');
    case 'done': {
      const sizes = i.before && i.after ? `${formatBytes(i.before)} → ${formatBytes(i.after)}` : t('Lista');
      return i.note ? `${sizes} · ${i.note}` : sizes;
    }
  }
}

function UploadQueue({ queue, onClose }: { queue: Queue; onClose: () => void }) {
  const n = queue.items.length;
  const finished = queue.items.filter((i) => i.status === 'done' || i.status === 'skipped' || i.status === 'error').length;
  const progress = queue.items.reduce((s, i) => s + (i.status === 'done' || i.status === 'skipped' || i.status === 'error' ? 1 : i.pct), 0) / Math.max(1, n);
  const ok = queue.items.filter((i) => i.status === 'done');
  const before = ok.reduce((s, i) => s + (i.before || 0), 0);
  const after = ok.reduce((s, i) => s + (i.after || 0), 0);
  const errors = queue.items.filter((i) => i.status === 'error').length;
  const title = queue.kind === 'existing' ? t('Optimizando fotos existentes') : t('Subida de fotos');
  return (
    <Card
      class="upload-queue"
      title={title}
      icon={queue.kind === 'existing' ? 'wand' : 'upload'}
      desc={
        queue.running
          ? t('{done} de {total} · no cierres esta página', { done: finished, total: n })
          : [
              t('{done} de {total} listas', { done: ok.length, total: n }),
              ok.length && before > after ? t('ahorro {size}', { size: formatBytes(before - after) }) : '',
              errors ? t('{n} con errores', { n: errors }) : '',
            ]
              .filter(Boolean)
              .join(' · ')
      }
      actions={
        !queue.running && (
          <Button size="sm" variant="ghost" icon="x" onClick={onClose}>
            {t('Cerrar')}
          </Button>
        )
      }
    >
      <div class="progress upload-queue__bar">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      <ul class="upload-queue__list">
        {queue.items.map((i) => (
          <li class={`uq uq--${i.status}`} key={i.id}>
            <span class="uq__thumb">
              {i.thumb ? (
                <img src={i.thumb} alt="" />
              ) : (
                <Icon name={i.status === 'error' ? 'alert' : i.status === 'skipped' ? 'x' : 'image'} size={16} />
              )}
            </span>
            <span class="uq__body">
              <span class="uq__name" title={i.name}>
                {i.name}
              </span>
              <span class="uq__status">
                {(i.status === 'optimizing' || i.status === 'heic' || i.status === 'uploading') && <span class="spinner spinner--xs" />}
                {i.status === 'done' && <Icon name="check" size={13} />}
                {statusText(i)}
              </span>
              {(i.status === 'optimizing' || i.status === 'heic' || i.status === 'uploading') && (
                <span class="progress progress--thin">
                  <span style={{ transform: `scaleX(${i.pct})` }} />
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
