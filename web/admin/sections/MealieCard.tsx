// Menús > Mealie: the meal plan of a Mealie server (family.meals.mealie in the config, server/mealie.js). The address
// and the photo setting are saved with the normal save bar; the API token is write-only and saved on its own, for
// the address typed next to it (the server only ever sends it there).
import { useEffect, useState } from 'preact/hooks';
import type { MealieConfig, MealieStatus, MealieTokenStatus, StoredConfig, TestMealieResponse } from '../../shared/types';
import { api, ApiError } from '../api';
import { toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { Button, Callout, Card, Field, TextInput, ToggleRow } from '../components/ui';
import { locale, t } from '../i18n';
import type { Errors } from '../util';

/** Text for a Mealie error code (server/mealie.js). */
export function mealieErrorText(code: string | null | undefined): string {
  switch (code) {
    case 'not_configured':
      return t('Escribe primero la dirección de Mealie');
    case 'invalid_url':
      return t('URL no válida');
    case 'token_missing':
      return t('Falta el token de API');
    case 'invalid_token':
      return t('Mealie no acepta el token');
    case 'old_version':
      return t('Hace falta Mealie 2.0 o posterior');
    case 'redirect':
      return t('Mealie redirige a otra dirección: usa la dirección final (por ejemplo, con https://)');
    case 'bad_response':
    case 'too_large':
      return t('Mealie respondió algo inesperado. Revisa la dirección.');
    default:
      return t('No se pudo conectar con Mealie');
  }
}

const errorCode = (e: unknown): string => {
  const b = (e as ApiError)?.body as { error?: unknown } | undefined;
  return typeof b?.error === 'string' ? b.error : '';
};

/** Put the Mealie settings in the draft: the block only exists with a URL or with the photo turned off. */
function putMealie(d: StoredConfig, patch: Partial<{ url: string; photo: boolean }>) {
  const cur = d.family.meals.mealie;
  const url = patch.url ?? cur?.url ?? '';
  const photo = patch.photo ?? cur?.photo !== false;
  if (!url.trim() && photo) delete d.family.meals.mealie;
  else d.family.meals.mealie = { url, ...(photo ? {} : { photo: false }) } as MealieConfig;
}

export function MealieCard({ full, setFull, saved, errors }: { full: StoredConfig; setFull: (fn: (d: StoredConfig) => void) => void; saved: StoredConfig; errors: Errors }) {
  const mm = full.family.meals.mealie;
  const url = mm?.url ?? '';
  const photo = mm?.photo !== false;
  const savedSig = `${saved.family?.enabled}|${saved.family?.meals?.enabled}|${saved.family?.meals?.mealie?.url ?? ''}`;
  const [tokenStatus, setTokenStatus] = useState<MealieTokenStatus | null>(null);
  const [token, setToken] = useState('');
  const [editToken, setEditToken] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [test, setTest] = useState<{ loading: boolean; res?: TestMealieResponse }>({ loading: false });
  const [status, setStatus] = useState<MealieStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = () => api.mealieStatus().then(setStatus).catch(() => setStatus(null));
  // what the server holds depends on the saved settings: ask again after each save that changes them
  useEffect(() => {
    api.mealieToken().then(setTokenStatus).catch(() => setTokenStatus(null));
    loadStatus();
  }, [savedSig]);

  const saveToken = async (value: string) => {
    if (value && !url.trim()) return toast(t('Escribe primero la dirección de Mealie'), 'error');
    setSavingToken(true);
    try {
      const st = await api.setMealieToken(value, url.trim() || undefined);
      setTokenStatus(st);
      setToken('');
      setEditToken(false);
      toast(value ? t('Token guardado') : t('Token quitado'));
      setTimeout(loadStatus, 1500);
    } catch (e) {
      const code = errorCode(e);
      toast(code === 'invalid_token' || code === 'invalid_url' ? mealieErrorText(code) : t('No se pudo guardar el token.'), 'error');
    } finally {
      setSavingToken(false);
    }
  };
  const runTest = async () => {
    setTest({ loading: true });
    try {
      const body: { url?: string; token?: string } = { url: url.trim() };
      if (token.trim()) body.token = token.trim();
      setTest({ loading: false, res: await api.testMealie(body) });
    } catch (e) {
      setTest({ loading: false, res: { ok: false, error: errorCode(e) || 'unreachable' } });
    }
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      setStatus(await api.refreshMealie());
      toast(t('Comidas de Mealie actualizadas'));
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const res = test.res;
  const time = (iso: string) => new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  return (
    <Card
      id="meals-mealie"
      scope="global"
      title="Mealie"
      icon="link"
      desc={t('Usa el plan de comidas de Mealie. Cada comida que tenga Mealie sustituye a la de Marco; el plan de Marco rellena el resto.')}
      actions={
        status?.usable ? (
          <Button size="sm" variant="ghost" icon="refresh" loading={refreshing} onClick={refresh}>
            {t('Actualizar ahora')}
          </Button>
        ) : undefined
      }
    >
      <div class="stack">
        <Field label={t('Dirección de Mealie')} error={errors['family.meals.mealie.url']} hint={t('Dirección local, p. ej. http://mealie.local:9925')}>
          <TextInput
            mono
            value={url}
            error={!!errors['family.meals.mealie.url']}
            placeholder="http://mealie.local:9925"
            onValue={(v) => setFull((d) => putMealie(d, { url: v }))}
            prefix={<Icon name="link" size={14} />}
          />
        </Field>
        <Field label={t('Token de API')} hint={`${t('Crea un token en Mealie: tu perfil > Tokens de API.')} ${t('Se guarda solo en el servidor y nunca se vuelve a mostrar.')}`}>
          {tokenStatus?.set && !editToken ? (
            <div class="search-row">
              <span class="wx-key-saved">
                <Icon name="check" size={14} /> {t('Token guardado')} {tokenStatus.hint && <span class="mono muted">…{tokenStatus.hint}</span>}
              </span>
              <Button onClick={() => setEditToken(true)}>{t('Cambiar')}</Button>
              <Button variant="danger" loading={savingToken} onClick={() => saveToken('')}>
                {t('Quitar')}
              </Button>
            </div>
          ) : (
            <form
              class="search-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (token.trim()) saveToken(token.trim());
              }}
            >
              <TextInput type="password" mono autocomplete="off" value={token} onValue={setToken} placeholder={t('Pega aquí tu token')} prefix={<Icon name="key" size={14} />} />
              <Button type="submit" variant="primary" disabled={!token.trim()} loading={savingToken}>
                {t('Guardar token')}
              </Button>
            </form>
          )}
        </Field>
        {tokenStatus?.otherUrl && <Callout kind="warn">{t('El token se guardó para otra dirección. Guárdalo otra vez para esta.')}</Callout>}
        <div class="row-actions">
          <Button icon="play" loading={test.loading} onClick={runTest} disabled={!url.trim()}>
            {t('Probar conexión')}
          </Button>
          {res &&
            (res.ok ? (
              <span class="ok-text">
                <Icon name="check" size={15} /> {t('Conectado a Mealie {v}. Comidas en las próximas dos semanas: {n}', { v: res.version ?? '', n: res.count ?? 0 })}
              </span>
            ) : (
              <span class="err-text">
                <Icon name="alert" size={15} /> {mealieErrorText(res.error)}
              </span>
            ))}
        </div>
        <ToggleRow
          label={t('Mostrar la foto de la cena')}
          hint={t('Cuando la receta de la cena tiene foto, se ve junto a las comidas de hoy.')}
          checked={photo}
          onChange={(v) => setFull((d) => putMealie(d, { photo: v }))}
        />
        {status?.usable && status.error && (
          <Callout kind="warn">{t('La última lectura falló: {error}. Se siguen mostrando las comidas de antes.', { error: mealieErrorText(status.error) })}</Callout>
        )}
        {status?.usable && status.updatedAt && !status.error && (
          <p class="muted small">{t('Última lectura: {time}. Comidas: {n}', { time: time(status.updatedAt), n: status.count ?? 0 })}</p>
        )}
        <p class="muted small">{t('Mealie también da el plan como calendario iCal: si prefieres verlo en el calendario, añádelo en Calendarios.')}</p>
      </div>
    </Card>
  );
}
