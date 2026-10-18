// Inspector fields of the data cards (Cripto, Deportes, Bolsa, Divisas): the coins with their currency, the teams and
// competitions followed, the stock symbols, the Finnhub key the stocks card needs, and the currency pairs (also the
// Currency widget's, sections/Widgets.tsx). Every search goes through this
// server (server/routes/data.js), which asks the source and keeps the answer.
import { useEffect, useRef, useState } from 'preact/hooks';
import './styles-data-pickers.css';
import { api, ApiError } from '../api';
import { caps } from '../caps';
import { t } from '../i18n';
import { Button, Callout, Select, TextInput } from '../components/ui';
import { DATA_LIMITS, FX_CURRENCIES, fxPairOf, MARKET_CURRENCIES, SPORTS_LEAGUES, STOCK_SYMBOL_RE } from '../../../server/core/dataCore.js';

type Coin = { id: string; sym: string; name: string; currency: string };
type Follow = { type: 'team' | 'league'; league: string; team?: string; name: string };
type Sym = { sym: string; name: string };
type Pair = { base: string; quote: string };

const errCode = (e: unknown) => (e instanceof ApiError ? String((e.body as { error?: string } | undefined)?.error ?? '') : '');
const leagueOf = (id: string) => SPORTS_LEAGUES.find((l) => l.id === id);
const SPORT_NAME: Record<string, string> = { soccer: 'Fútbol', basketball: 'Baloncesto', football: 'Fútbol americano', hockey: 'Hockey sobre hielo', baseball: 'Béisbol' };

/** A search box that asks after a short pause; `run` gives the results or throws. */
function useSearch<T>(run: (q: string) => Promise<T[]>, min = 2) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<T[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const text = q.trim();
    if (text.length < min) {
      setRes(null);
      setErr('');
      return;
    }
    const n = ++seq.current;
    const tm = setTimeout(() => {
      setBusy(true);
      run(text).then(
        (r) => n === seq.current && (setRes(r), setErr('')),
        (e) => n === seq.current && (setRes([]), setErr(errCode(e) || 'fetch_failed')),
      ).finally(() => n === seq.current && setBusy(false));
    }, 450);
    return () => clearTimeout(tm);
  }, [q]);
  return { q, setQ, res, err, busy, clear: () => (setQ(''), setRes(null)) };
}

function searchError(code: string): string {
  if (code === 'no_key' || code === 'key_refused') return t('Guarda primero la clave de Finnhub, más abajo.');
  if (code === 'rate_limited') return t('El servicio pide esperar un poco. Prueba dentro de un minuto.');
  return t('No se ha podido buscar ahora. Prueba otra vez en un momento.');
}

// ------------------------------------------------------------------------------------------------ coins

export function CoinsField({ value, onChange }: { value: Coin[]; onChange: (v: Coin[]) => void }) {
  const coins = Array.isArray(value) ? value : [];
  const s = useSearch((q) => api.dataCoins(q).then((r) => r.coins));
  const full = coins.length >= DATA_LIMITS.coins;
  const add = (c: { id: string; sym: string; name: string }) => {
    if (full || coins.some((x) => x.id === c.id)) return;
    onChange([...coins, { id: c.id, sym: c.sym, name: c.name, currency: coins[0]?.currency ?? 'eur' }]);
    s.clear();
  };
  return (
    <div class="stack bld-dlist">
      {coins.map((c, i) => (
        <div class="bld-drow">
          <span class="bld-dbadge">{c.sym || c.id.slice(0, 4).toUpperCase()}</span>
          <span class="bld-dname">{c.name || c.id}</span>
          <Select
            value={c.currency}
            options={MARKET_CURRENCIES.map((x) => ({ value: x, label: x.toUpperCase() }))}
            onChange={(v) => onChange(coins.map((x, j) => (j === i ? { ...x, currency: String(v) } : x)))}
          />
          <button type="button" class="icon-btn" onClick={() => onChange(coins.filter((_, j) => j !== i))} aria-label={t('Quitar')}>
            ×
          </button>
        </div>
      ))}
      {!full && <TextInput value={s.q} placeholder={t('Busca una moneda: bitcoin, eth…')} onValue={s.setQ} aria-label={t('Buscar moneda')} />}
      {full && <p class="muted small">{t('Seis monedas como mucho por tarjeta.')}</p>}
      {s.busy && <p class="muted small">{t('Buscando…')}</p>}
      {s.err && <p class="muted small">{searchError(s.err)}</p>}
      {s.res && !s.err && (
        <div class="bld-dresults" role="listbox">
          {s.res.length === 0 && <p class="muted small">{t('Nada con ese nombre.')}</p>}
          {s.res.map((c) => (
            <button type="button" class="bld-dres" disabled={coins.some((x) => x.id === c.id)} onClick={() => add(c)}>
              <b>{c.sym}</b> <span>{c.name}</span>
              {c.rank ? <span class="muted small"> #{c.rank}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ teams and competitions

export function FollowField({ value, onChange }: { value: Follow[]; onChange: (v: Follow[]) => void }) {
  const list = Array.isArray(value) ? value : [];
  const [league, setLeague] = useState(list[list.length - 1]?.league ?? 'esp.1');
  const [teams, setTeams] = useState<{ id: string; name: string; abbr: string }[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    let alive = true;
    setTeams(null);
    setErr('');
    api.dataTeams(league).then(
      (r) => alive && setTeams(r.teams),
      (e) => alive && (setTeams([]), setErr(errCode(e) || 'fetch_failed')),
    );
    return () => {
      alive = false;
    };
  }, [league]);
  const full = list.length >= DATA_LIMITS.follow;
  const has = (f: Follow) => list.some((x) => x.league === f.league && (x.team ?? '') === (f.team ?? ''));
  const add = (f: Follow) => {
    if (full || has(f)) return;
    onChange([...list, f]);
    setQ('');
  };
  const text = q.trim().toLowerCase();
  const shown = (teams ?? []).filter((x) => !text || x.name.toLowerCase().includes(text) || x.abbr.toLowerCase() === text).slice(0, 12);
  return (
    <div class="stack bld-dlist">
      {list.map((f, i) => (
        <div class="bld-drow">
          <span class="bld-dname">
            {f.type === 'team' ? f.name || f.team : leagueOf(f.league)?.name ?? f.league}
            <span class="muted small"> · {f.type === 'team' ? leagueOf(f.league)?.short ?? f.league : t('Toda la competición')}</span>
          </span>
          <button type="button" class="icon-btn" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={t('Quitar')}>
            ×
          </button>
        </div>
      ))}
      {full ? (
        <p class="muted small">{t('Cuatro como mucho por tarjeta.')}</p>
      ) : (
        <>
          <Select value={league} options={SPORTS_LEAGUES.map((l) => ({ value: l.id, label: l.name, group: t(SPORT_NAME[l.sport] ?? 'Otros') }))} onChange={(v) => setLeague(String(v))} />
          <Button size="sm" disabled={has({ type: 'league', league, name: '' })} onClick={() => add({ type: 'league', league, name: '' })}>
            {t('Añadir toda la competición')}
          </Button>
          <TextInput value={q} placeholder={t('O busca un equipo de esta competición')} onValue={setQ} aria-label={t('Buscar equipo')} />
          {teams === null && <p class="muted small">{t('Cargando equipos…')}</p>}
          {err && <p class="muted small">{searchError(err)}</p>}
          {teams && !err && text && (
            <div class="bld-dresults" role="listbox">
              {shown.length === 0 && <p class="muted small">{t('Nada con ese nombre.')}</p>}
              {shown.map((x) => (
                <button type="button" class="bld-dres" disabled={has({ type: 'team', league, team: x.id, name: '' })} onClick={() => add({ type: 'team', league, team: x.id, name: x.name })}>
                  <b>{x.abbr}</b> <span>{x.name}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ stock symbols

export function SymbolsField({ value, onChange }: { value: Sym[]; onChange: (v: Sym[]) => void }) {
  const syms = Array.isArray(value) ? value : [];
  const s = useSearch((q) => api.dataSymbols(q).then((r) => r.symbols), 1);
  const full = syms.length >= DATA_LIMITS.symbols;
  const add = (x: Sym) => {
    if (full || syms.some((y) => y.sym === x.sym)) return;
    onChange([...syms, x]);
    s.clear();
  };
  const typed = s.q.trim().toUpperCase();
  const none = useNoData(syms);
  // a currency pair typed into the search (EURHUF, EUR/HUF, OANDA:EUR_HUF): the free key has no forex
  const typedPair = fxPairOf(typed);
  return (
    <div class="stack bld-dlist">
      {syms.map((x, i) => (
        <>
          <div class="bld-drow">
            <span class="bld-dbadge is-wide">{x.sym}</span>
            <TextInput value={x.name} maxLength={40} placeholder={t('Nombre')} onValue={(v) => onChange(syms.map((y, j) => (j === i ? { ...y, name: v } : y)))} aria-label={t('Nombre')} />
            <button type="button" class="icon-btn" onClick={() => onChange(syms.filter((_, j) => j !== i))} aria-label={t('Quitar')}>
              ×
            </button>
          </div>
          {none.has(x.sym) && <NoDataNote sym={x.sym} />}
        </>
      ))}
      {typedPair && !syms.some((y) => y.sym === typed) && <FxHint pair={typedPair} />}
      {!full && <TextInput value={s.q} placeholder={t('Busca un valor: Apple, MSFT…')} onValue={s.setQ} aria-label={t('Buscar valor')} />}
      {full && <p class="muted small">{t('Doce valores como mucho por tarjeta.')}</p>}
      {s.busy && <p class="muted small">{t('Buscando…')}</p>}
      {s.err && <p class="muted small">{searchError(s.err)}</p>}
      {!full && STOCK_SYMBOL_RE.test(typed) && !syms.some((y) => y.sym === typed) && (s.err || (s.res && !s.res.some((r) => r.sym === typed))) && (
        <button type="button" class="link-btn" onClick={() => add({ sym: typed, name: '' })}>
          {t('Añadir {s} tal cual', { s: typed })}
        </button>
      )}
      {s.res && !s.err && (
        <div class="bld-dresults" role="listbox">
          {s.res.length === 0 && <p class="muted small">{t('Nada con ese nombre.')}</p>}
          {s.res.map((r) => (
            <button type="button" class="bld-dres" disabled={syms.some((y) => y.sym === r.sym)} onClick={() => add({ sym: r.sym, name: r.name ? r.name.charAt(0) + r.name.slice(1).toLowerCase() : '' })}>
              <b>{r.sym}</b> <span>{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The symbols of the list Finnhub has nothing for with this key (unknown, all zeros, or not on its plan): asked a
 * moment after the list changes, through the builder's preview route (the server's own cache, no extra call).
 */
function useNoData(syms: Sym[]): Set<string> {
  const [none, setNone] = useState<Set<string>>(new Set());
  const sig = syms.map((x) => x.sym).join(',');
  useEffect(() => {
    if (!sig) return setNone(new Set());
    let alive = true;
    const tm = setTimeout(() => {
      api.dataPreview({ items: [{ id: 'cv_symcheck', kind: 'stocks', props: { symbols: syms.map((x) => ({ sym: x.sym, name: '' })), layout: 'list' } }] }).then(
        (r) => {
          const d = r.items.cv_symcheck;
          if (!alive || !d || d.kind !== 'stocks' || d.needsKey) return;
          setNone(new Set(d.quotes.filter((q) => q.noData).map((q) => q.sym)));
        },
        () => undefined,
      );
    }, 600);
    return () => {
      alive = false;
      clearTimeout(tm);
    };
  }, [sig]);
  return none;
}

/** A symbol with no data: say so, and point a currency pair to the Divisas card. */
function NoDataNote({ sym }: { sym: string }) {
  const pair = fxPairOf(sym);
  return (
    <p class="muted small bld-note">
      {t('Finnhub no tiene datos de {s} con la clave gratuita.', { s: sym })}
      {pair && <> {t('Para el cambio {p}, usa la tarjeta Divisas.', { p: `${pair.base}/${pair.quote}` })}</>}
    </p>
  );
}

function FxHint({ pair }: { pair: Pair }) {
  return <p class="muted small bld-note">{t('La clave gratuita de Finnhub no tiene divisas. Para el cambio {p}, usa la tarjeta Divisas.', { p: `${pair.base}/${pair.quote}` })}</p>;
}

// ------------------------------------------------------------------------------------------------ currency pairs

let currencyList: Promise<{ code: string; name: string }[]> | null = null;
/** The ECB's currencies (the source's list, cached a day by the server; the built-in one when it cannot be read). */
function loadCurrencies(): Promise<{ code: string; name: string }[]> {
  currencyList ??= api.dataCurrencies().then(
    (r) => (r.currencies.length ? r.currencies : FX_CURRENCIES.map((code) => ({ code, name: '' }))),
    () => {
      currencyList = null;
      return FX_CURRENCIES.map((code) => ({ code, name: '' }));
    },
  );
  return currencyList;
}

/** A currency's name in the admin's language, else the source's (English). */
function curName(code: string, fallback = ''): string {
  try {
    const n = new Intl.DisplayNames([document.documentElement.lang || 'es'], { type: 'currency' }).of(code);
    if (n && n !== code) return n.charAt(0).toUpperCase() + n.slice(1);
  } catch {
    // no Intl.DisplayNames: the source's name
  }
  return fallback;
}

/**
 * The pairs of a Divisas card or a Currency widget: each a base and a quote from the ECB's currencies (both can be
 * changed, or swapped), and a search that takes a pair as written (EURHUF, eur/huf) or a currency by code or name.
 */
export function PairsField({ value, onChange }: { value: Pair[]; onChange: (v: Pair[]) => void }) {
  const pairs = Array.isArray(value) ? value : [];
  const [list, setList] = useState<{ code: string; name: string }[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    let alive = true;
    void loadCurrencies().then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, []);
  const codes = list ?? FX_CURRENCIES.map((code) => ({ code, name: '' }));
  const label = (c: { code: string; name: string }) => `${c.code} · ${curName(c.code, c.name)}`.replace(/ · $/, '');
  const opts = codes.map((c) => ({ value: c.code, label: label(c) }));
  const full = pairs.length >= DATA_LIMITS.pairs;
  const has = (x: Pair) => pairs.some((y) => y.base === x.base && y.quote === x.quote);
  const add = (x: Pair) => {
    if (full || has(x) || x.base === x.quote) return;
    onChange([...pairs, x]);
    setQ('');
  };
  const set = (i: number, x: Pair) => onChange(pairs.map((y, j) => (j === i ? x : y)));
  // the search: a pair as written, or currencies by code or name (each against the euro, or the euro against the dollar)
  const text = q.trim();
  const known = new Set(codes.map((c) => c.code));
  const m = /^([a-z]{3})\s*[/_\-. ]?\s*([a-z]{3})$/i.exec(text);
  const typed = m && known.has(m[1].toUpperCase()) && known.has(m[2].toUpperCase()) && m[1].toUpperCase() !== m[2].toUpperCase() ? { base: m[1].toUpperCase(), quote: m[2].toUpperCase() } : null;
  const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const found = text.length >= 2 && !typed
    ? codes.filter((c) => fold(c.code).includes(fold(text)) || fold(curName(c.code, c.name)).includes(fold(text)) || fold(c.name).includes(fold(text))).slice(0, 8)
    : [];
  const results: Pair[] = typed ? [typed] : found.map((c) => (c.code === 'EUR' ? { base: 'EUR', quote: 'USD' } : { base: 'EUR', quote: c.code }));
  return (
    <div class="stack bld-dlist">
      {pairs.map((x, i) => (
        <div class="bld-drow bld-fxrow">
          <Select value={x.base} options={opts} aria-label={t('Moneda de origen')} onChange={(v) => set(i, { ...x, base: String(v) })} />
          <button type="button" class="icon-btn" title={t('Dar la vuelta')} aria-label={t('Dar la vuelta')} onClick={() => set(i, { base: x.quote, quote: x.base })}>
            ⇄
          </button>
          <Select value={x.quote} options={opts} aria-label={t('Moneda de destino')} onChange={(v) => set(i, { ...x, quote: String(v) })} />
          <button type="button" class="icon-btn" onClick={() => onChange(pairs.filter((_, j) => j !== i))} aria-label={t('Quitar')}>
            ×
          </button>
        </div>
      ))}
      {pairs.some((x) => x.base === x.quote) && <p class="muted small">{t('Elige dos monedas distintas.')}</p>}
      {!full && <TextInput value={q} placeholder={t('Busca: EUR/HUF, forinto, dólar…')} onValue={setQ} aria-label={t('Buscar divisa')} />}
      {full && <p class="muted small">{t('Seis pares como mucho.')}</p>}
      {text.length >= 2 && (
        <div class="bld-dresults" role="listbox">
          {results.length === 0 && <p class="muted small">{t('Nada con ese nombre.')}</p>}
          {results.map((x) => (
            <button type="button" class="bld-dres" disabled={has(x)} onClick={() => add(x)}>
              <b>{x.base}/{x.quote}</b> <span>{curName(x.quote, codes.find((c) => c.code === x.quote)?.name ?? '')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The Finnhub key: write-only (only its last four characters come back), tried once before the server keeps it. */
export function StocksKeyField() {
  // on Marco Cloud the key belongs to the service, not to the household
  if (caps().edition === 'cloud') return null;
  return <StocksKeyForm />;
}

function StocksKeyForm() {
  const [st, setSt] = useState<{ set: boolean; last4: string } | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    api.stocksKey().then(setSt, () => setSt({ set: false, last4: '' }));
  }, []);
  const save = async (k: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.putStocksKey(k);
      setSt(r);
      setKey('');
      setMsg(k ? { kind: 'ok', text: r.checked ? t('Clave guardada. Finnhub la ha aceptado.') : t('Clave guardada. No se ha podido probar ahora.') } : { kind: 'ok', text: t('Clave quitada.') });
    } catch (e) {
      setMsg({ kind: 'error', text: errCode(e) === 'key_invalid' ? t('Finnhub no acepta esta clave.') : t('No se ha podido guardar la clave.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="stack">
      <p class="muted small bld-note">
        {t('Bolsa necesita una clave gratuita de Finnhub (finnhub.io). Se guarda en este servidor y nunca llega a las pantallas.')}
      </p>
      {st?.set && <p class="small">{t('Clave guardada, termina en {x}.', { x: st.last4 })}</p>}
      <div class="bld-drow">
        <TextInput type="password" autocomplete="off" value={key} maxLength={64} placeholder={st?.set ? t('Nueva clave') : t('Clave de Finnhub')} onValue={setKey} aria-label={t('Clave de Finnhub')} />
        <Button size="sm" variant="primary" loading={busy} disabled={!key.trim()} onClick={() => void save(key.trim())}>
          {t('Guardar')}
        </Button>
        {st?.set && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save('')}>
            {t('Quitar')}
          </Button>
        )}
      </div>
      {msg && <Callout kind={msg.kind}>{msg.text}</Callout>}
    </div>
  );
}
