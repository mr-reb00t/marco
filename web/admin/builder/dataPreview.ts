// The numbers of the draft's data cards (Cripto, Deportes, Bolsa) for the builder's preview: the items as they are in
// the editor go to POST /api/admin/data/preview (the server's own cache, so the preview never costs the sources more
// than the screens do), and Stage.tsx posts the answer to the frame ('marco:preview-data'). Asked again a moment after
// a data card changes and every minute while the builder stays open.
import { canvasCards } from '../../../server/core/canvasCore.js';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { CanvasConfig, DataItemData } from '../../shared/types';
import { api } from '../api';

const KINDS = ['market', 'sports', 'stocks'];
const EVERY_MS = 60_000;

export function useDataPreview(cv: CanvasConfig | null): Record<string, DataItemData> {
  const items = useMemo(() => canvasCards(cv?.items).filter((it) => KINDS.includes(it.kind)).map((it) => ({ id: it.id, kind: it.kind, props: it.props as Record<string, unknown> })), [cv]);
  const sig = JSON.stringify(items);
  const [out, setOut] = useState<Record<string, DataItemData>>({});
  useEffect(() => {
    if (!items.length) return;
    let alive = true;
    const load = () => api.dataPreview({ items }).then((r) => alive && setOut((o) => ({ ...o, ...r.items })), () => undefined);
    const first = setTimeout(load, 500);
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, EVERY_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [sig]);
  return out;
}
