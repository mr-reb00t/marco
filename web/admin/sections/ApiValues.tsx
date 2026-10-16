// API y webhooks: "Conectar desde Home Assistant" for the Valor card. The owner picks keys and the Home Assistant
// entities that feed them; the page writes one rest_command and one automation that sends all of them together in a
// single request (the hook keeps one update per key every 2 s, and a token may send 30 requests a minute). Below it,
// the values the server has now, with a button to clear one.
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { HookValueInfo, StoredConfig } from '../../shared/types';
import { VALUE_KEY_RE, canvasCards } from '../../../server/core/canvasCore.js';
import { api, ApiError } from '../api';
import { toast } from '../components/feedback';
import { Button, Card, Empty, Field, Select, TextInput } from '../components/ui';
import { relTime, t } from '../i18n';
import { valueLabel } from '../builder/ValueKeyInput';

type Kind = 'number' | 'text' | 'onoff';
interface Row {
  key: string;
  entity: string;
  kind: Kind;
  unit: string;
}

const ENTITY_RE = /^[a-z_]+\.[a-z0-9_]+$/;

/** The keys the saved screens show (Valor cards and custom cards bound to a key), in screen order, no repeats. */
export function usedValueKeys(full: StoredConfig): string[] {
  const out: string[] = [];
  for (const s of full.screens ?? []) {
    if (s.layout?.preset !== 'canvas') continue;
    for (const it of canvasCards(s.canvas?.items)) {
      const p = it.props as { key?: string; bind?: { value?: string }[] };
      if (it.kind === 'value' && p.key) out.push(p.key);
      if (it.kind === 'html') for (const b of p.bind ?? []) if (b?.value) out.push(b.value);
    }
  }
  return [...new Set(out)];
}

/** The Jinja expression that sends an entity's state as a number, a text or true/false. */
function valueExpr(r: Row): string {
  const e = JSON.stringify(r.entity);
  if (r.kind === 'number') return `{{ states(${e}) | float(0) }}`;
  if (r.kind === 'onoff') return `{{ is_state(${e}, 'on') | tojson }}`;
  // the hook refuses texts over 120 characters, so a long state is cut here
  return `{{ states(${e})[:120] | tojson }}`;
}

/** rest_command and automation for `rows` (only complete ones). Exported for the tests. */
export function valuesYaml(rows: Row[], base: string, token: string, alias: string, header: string): string {
  const ok = rows.filter((r) => VALUE_KEY_RE.test(r.key) && ENTITY_RE.test(r.entity));
  const items = ok.map((r) => `        {"key": ${JSON.stringify(r.key)}, "value": ${valueExpr(r)}${r.unit && r.kind === 'number' ? `, "unit": ${JSON.stringify(r.unit)}` : ''}}`);
  const entities = [...new Set(ok.map((r) => r.entity))];
  return `# ${header}
rest_command:
  marco_values:
    url: "${base}/api/hooks/values"
    method: POST
    headers:
      Authorization: "Bearer ${token}"
    content_type: "application/json"
    payload: >-
      {"values": [
${items.join(',\n') || '        {"key": "solar.today", "value": {{ states(\'sensor.solar_energy_today\') | float(0) }}, "unit": "kWh"}'}
      ]}

automation marco:
  - alias: "${alias}"
    triggers:
      - trigger: state
        entity_id:
${(entities.length ? entities : ['sensor.solar_energy_today']).map((e) => `          - ${e}`).join('\n')}
      - trigger: time_pattern
        minutes: "/15"
      - trigger: homeassistant
        event: start
    actions:
      - action: rest_command.marco_values
      - delay: "00:00:05"
    mode: queued
    max: 2
    max_exceeded: silent`;
}

export function ValuesHelper({ full, base, token, code }: { full: StoredConfig; base: string; token: string; code: (yaml: string) => ComponentChildren }) {
  const used = useMemo(() => usedValueKeys(full), [full]);
  const [rows, setRows] = useState<Row[]>(() => (used.length ? used : ['solar.today']).slice(0, 20).map((key) => ({ key, entity: '', kind: 'number', unit: '' })));
  const [values, setValues] = useState<HookValueInfo[] | null>(null);
  const load = () =>
    api.hookValues().then(
      (r) => setValues(r.values),
      () => setValues([]),
    );
  useEffect(() => void load(), []);
  const put = (i: number, r: Partial<Row>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...r } : x)));
  const clear = async (key: string) => {
    try {
      await api.deleteHookValue(key);
      toast(t('Valor borrado'));
      void load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };
  const yaml = valuesYaml(rows, base, token, t('Valores para Marco'), t('configuration.yaml de Home Assistant'));
  const kinds = [
    { value: 'number' as Kind, label: t('Número') },
    { value: 'text' as Kind, label: t('Texto') },
    { value: 'onoff' as Kind, label: t('Encendido o apagado') },
  ];
  return (
    <Card title={t('Conectar desde Home Assistant')} icon="activity" id="api-values" desc={t('Envía el estado de tus sensores a las tarjetas Valor de Personalizado. Una sola automatización manda todas las claves juntas.')}>
      <div class="stack">
        {rows.map((r, i) => (
          <div class="api-values__row">
            <Field label={i === 0 ? t('Clave') : undefined}>
              <TextInput mono value={r.key} maxLength={40} placeholder="solar.today" error={!!r.key && !VALUE_KEY_RE.test(r.key)} onValue={(v) => put(i, { key: v.trim() })} />
            </Field>
            <Field label={i === 0 ? t('Entidad de Home Assistant') : undefined}>
              <TextInput mono value={r.entity} maxLength={120} placeholder="sensor.solar_energy_today" error={!!r.entity && !ENTITY_RE.test(r.entity)} onValue={(v) => put(i, { entity: v.trim() })} />
            </Field>
            <Field label={i === 0 ? t('Se envía como') : undefined}>
              <Select value={r.kind} options={kinds} onChange={(v) => put(i, { kind: v })} />
            </Field>
            <Field label={i === 0 ? t('Unidad') : undefined}>
              <TextInput value={r.unit} maxLength={12} placeholder="kWh" disabled={r.kind !== 'number'} onValue={(v) => put(i, { unit: v })} />
            </Field>
            <button type="button" class="icon-btn" aria-label={t('Quitar')} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
        {rows.length < 20 && (
          <button type="button" class="link-btn" onClick={() => setRows([...rows, { key: '', entity: '', kind: 'number', unit: '' }])}>
            {t('Añadir clave')}
          </button>
        )}
        <p class="muted small">
          {t('Se envía cuando cambia alguna de las entidades, cada 15 minutos y al arrancar Home Assistant, como mucho una vez cada 5 segundos. El token necesita el permiso Valores.')}
        </p>
        {code(yaml)}
        <h4>{t('Valores recibidos')}</h4>
        {values === null ? (
          <div class="skeleton-list">
            <div class="skeleton" />
          </div>
        ) : values.length === 0 ? (
          <Empty icon="activity" title={t('Todavía no ha llegado ningún valor')} />
        ) : (
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>{t('Clave')}</th>
                  <th>{t('Valor')}</th>
                  <th>{t('Actualizado')}</th>
                  <th>{t('Pantallas')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {values.map((v) => (
                  <tr>
                    <td>
                      <code class="mono small api-values__key">{v.key}</code>
                    </td>
                    <td>
                      {valueLabel(v)}
                      {v.label && <span class="muted small"> · {v.label}</span>}
                    </td>
                    <td class="muted" title={v.updatedAt}>
                      {relTime(v.updatedAt)}
                    </td>
                    <td class="muted small">{v.screens.length ? v.screens.join(', ') : t('Ninguna')}</td>
                    <td class="num">
                      <Button size="sm" variant="ghost" icon="trash" onClick={() => clear(v.key)}>
                        {t('Borrar')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
