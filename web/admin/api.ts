import type {
  HaStatistic,
  HookValueInfo,
  TokenScope,
  TestWidgetResponse,
  WidgetType,
  TestPricesResponse,
  PrivacyChangeResponse,
  PrivacyRequest,
  PrivacyResponse,
  ActivityResponse,
  AdminPhoto,
  PhotoConflictPolicy,
  PhotoNameCheck,
  PhotoUploadResult,
  AdminStatus,
  AnnounceRequest,
  AnnounceResponse,
  AnnouncementsResponse,
  DoorbellRequest,
  DoorbellResponse,
  ApiTokenCreated,
  ApiTokenInfo,
  AuthMeResponse,
  TwoFactorStatus,
  TwoFactorSetup,
  RecoveryCodesResponse,
  TwoFactorLoginResponse,
  AccountSessionsResponse,
  AccountGoogleStatus,
  BackupInfo,
  BirthdayCsvResult,
  DashboardResponse,
  DisplayCommandRequest,
  DisplaysResponse,
  DisplayLink,
  DisplayLinksResponse,
  DevicesResponse,
  PairClaimRequest,
  PairClaimResponse,
  GeocodeResponse,
  HaAdminActionRequest,
  PairedDevice,
  EventsPreviewRequest,
  FamilyAdminState,
  EventsPreviewResponse,
  ExportBundle,
  ImportApplyRequest,
  ImportPreview,
  ScreenProfile,
  SetupCompleteResponse,
  SetupRequest,
  SetupStatus,
  StoredConfig,
  SaveConfigRequest,
  CountdownsResponse,
  GoogleAccount,
  HealthResponse,
  HouseholdInfo,
  GoogleCalendarListItem,
  MicrosoftAccount,
  MicrosoftCalendarListItem,
  HaAdminHistory, HaEntity, HaLiveStatus, HaSlim,
  TestHomeAssistantResponse,
  WeatherKeyStatus,
  TestImmichResponse,
  ImmichKeyStatus,
  ImmichAlbum,
  ImmichStatus,
  TestIcsResponse,
  TestRssResponse,
  UpdateInfo,
  UpdateSettings,
  FeedbackRequest,
  FeedbackResponse,
  CoinSearchResult, DataPreviewRequest, DataPreviewResponse, SportsLeaguesResult, SportsTeamsResult, StocksKeyStatus, SymbolSearchResult,
} from '../shared/types';
import { getLang } from './i18n';
import { apiErrorCode, apiErrorMessage, type ApiErrorCode } from './apiErrors';

export class ApiError extends Error {
  status: number;
  body: unknown;
  /** Known error code from the body (apiErrors.ts), '' when there is none. */
  code: ApiErrorCode | '';
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
    this.code = apiErrorCode(body);
  }
}

/** Fired on any 401 so the app can drop back to the login screen. */
export const UNAUTHORIZED_EVENT = 'admin:unauthorized';

/** `stepUp401`: a 401 with code 'reauth' asks for a recent sign-in for this one change (Marco Cloud's account
 *  settings); the session itself is fine, so the admin stays where it is and the caller shows the message. */
async function request<T>(method: string, url: string, body?: unknown, opts: { silent401?: boolean; stepUp401?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'fetch', ...(opts.headers ?? {}) };
  let payload: string | undefined;
  if (method !== 'GET') {
    // Every mutating call is JSON (server CSRF check relies on the content type).
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  } catch (e) {
    throw new ApiError(0, 'network');
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const stepUp = opts.stepUp401 && (data as { code?: unknown } | null)?.code === 'reauth';
    if (res.status === 401 && !opts.silent401 && !stepUp) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    throw new ApiError(res.status, apiErrorMessage(res.status, data), data);
  }
  return data as T;
}

function isConfig(x: any): x is StoredConfig {
  return x && typeof x === 'object' && x.calendar && Array.isArray(x.screens) && typeof x.revision === 'number';
}

const q = (params: Record<string, string | number | undefined | null>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};

export const api = {
  health: () => request<HealthResponse>('GET', '/api/health', undefined, { silent401: true }),
  me: () => request<AuthMeResponse>('GET', '/api/auth/me', undefined, { silent401: true }),
  login: (password: string) => request<unknown>('POST', '/api/auth/login', { password }, { silent401: true }),
  logout: () => request<unknown>('POST', '/api/auth/logout', {}, { silent401: true }),
  logoutAll: () => request<unknown>('POST', '/api/auth/logout-all', {}, { silent401: true }),
  // Two-step sign-in (features.twoFactor). The sign-in step answers 401 for a wrong code, not for an expired session.
  login2fa: (code: string) => request<TwoFactorLoginResponse>('POST', '/api/auth/2fa', { code }, { silent401: true }),
  twoFactorStatus: () => request<TwoFactorStatus>('GET', '/api/admin/2fa'),
  twoFactorSetup: (password?: string) => request<TwoFactorSetup>('POST', '/api/admin/2fa/setup', password ? { password } : {}),
  twoFactorEnable: (code: string) => request<RecoveryCodesResponse>('POST', '/api/admin/2fa/enable', { code }),
  twoFactorDisable: (proof: { password?: string; code?: string }) => request<{ ok: true }>('POST', '/api/admin/2fa/disable', proof),
  twoFactorRecoveryCodes: (proof: { password?: string; code?: string }) =>
    request<RecoveryCodesResponse>('POST', '/api/admin/2fa/recovery-codes', proof),

  // Marco Cloud account settings (features.accountSettings), shown on the account page. Changes that need a recent
  // sign-in answer 401 { code: 'reauth' } without signing the admin out (stepUp401).
  accountPassword: (password: string, current?: string) =>
    request<{ ok: true }>('POST', '/api/account/password', current ? { current, password } : { password }, { stepUp401: true }),
  accountSessions: () => request<AccountSessionsResponse>('GET', '/api/auth/sessions'),
  accountRevokeSession: (id: string) => request<{ ok: true; current: boolean }>('DELETE', `/api/auth/sessions/${encodeURIComponent(id)}`),
  accountGoogle: () => request<AccountGoogleStatus>('GET', '/api/account/google'),
  accountGoogleDisconnect: () => request<{ ok: true; removed: boolean }>('POST', '/api/account/google/disconnect', {}),
  accountDelete: (password: string) => request<{ ok: true; next?: string }>('POST', '/api/account/delete', { password }),
  accountDeleteByEmail: () => request<{ ok: true }>('POST', '/api/account/delete/start', {}),
  accountTwoFactorStatus: () => request<TwoFactorStatus>('GET', '/api/account/two-factor'),
  accountTwoFactorSetup: (password?: string) =>
    request<TwoFactorSetup>('POST', '/api/account/two-factor/setup', password ? { password } : {}, { stepUp401: true }),
  accountTwoFactorEnable: (code: string) => request<RecoveryCodesResponse>('POST', '/api/account/two-factor/enable', { code }),
  accountTwoFactorDisable: (proof: { password?: string; code?: string }) =>
    request<{ ok: true }>('POST', '/api/account/two-factor/disable', proof, { stepUp401: true }),
  accountTwoFactorRecoveryCodes: (proof: { password?: string; code?: string }) =>
    request<RecoveryCodesResponse>('POST', '/api/account/two-factor/recovery-codes', proof, { stepUp401: true }),

  // Marco Cloud account (features.accountMenu): the language follows the account, the household can be renamed.
  accountLang: (lang: string) => request<{ ok: true }>('POST', '/api/account/lang', { lang }),
  renameHousehold: (name: string) => request<{ ok: true; household: HouseholdInfo }>('PATCH', '/api/admin/household', { name }),
  // Marco Cloud only (features.feedback): help and feedback form, mailed to the team with the signed in email as reply-to.
  sendFeedback: (body: FeedbackRequest) => request<FeedbackResponse>('POST', '/api/admin/feedback', body),

  // First-run setup wizard (no session yet; the optional setup token travels in x-setup-token).
  setupStatus: (token?: string) =>
    request<SetupStatus>('GET', '/api/setup/status', undefined, { silent401: true, headers: token ? { 'x-setup-token': token } : {} }),
  setupTestIcs: (url: string, token?: string) =>
    request<TestIcsResponse>('POST', '/api/setup/test-ics', { url }, { silent401: true, headers: token ? { 'x-setup-token': token } : {} }),
  setupComplete: (body: SetupRequest) =>
    request<SetupCompleteResponse>('POST', '/api/setup/complete', body, { silent401: true, headers: body.token ? { 'x-setup-token': body.token } : {} }),

  getConfig: () => request<StoredConfig>('GET', '/api/admin/config'),
  /** PUT the whole (v2) config. Returns the saved config (refetches if the server does not echo it).
   *  With `baseRevision` the server answers 409 conflict when the config was saved since that revision. */
  async saveConfig(body: SaveConfigRequest): Promise<StoredConfig> {
    const res = await request<any>('PUT', '/api/admin/config', body);
    if (isConfig(res)) return res;
    if (res && isConfig(res.config)) return res.config;
    return api.getConfig();
  },
  // 401 here means "wrong current password", not an expired session.
  changePassword: (current: string, next: string) =>
    request<unknown>('PUT', '/api/admin/password', { current, next }, { silent401: true }),

  googleAccounts: () => request<GoogleAccount[]>('GET', '/api/admin/google/accounts'),
  removeGoogleAccount: (email: string) =>
    request<unknown>('DELETE', `/api/admin/google/accounts/${encodeURIComponent(email)}`),
  googleCalendars: (account: string) =>
    request<GoogleCalendarListItem[]>('GET', `/api/admin/google/calendars?account=${encodeURIComponent(account)}`),

  // Marco Cloud only (features.microsoftCalendar): Outlook.com, Hotmail and Microsoft 365 calendars.
  microsoftAccounts: () => request<MicrosoftAccount[]>('GET', '/api/admin/microsoft/accounts'),
  removeMicrosoftAccount: (email: string) =>
    request<unknown>('DELETE', `/api/admin/microsoft/accounts/${encodeURIComponent(email)}`),
  microsoftCalendars: (account: string) =>
    request<MicrosoftCalendarListItem[]>('GET', `/api/admin/microsoft/calendars?account=${encodeURIComponent(account)}`),

  testIcs: (url: string, insecureTls?: boolean) =>
    request<TestIcsResponse>('POST', '/api/admin/test/ics', insecureTls ? { url, insecureTls: true } : { url }),
  testRss: (url: string) => request<TestRssResponse>('POST', '/api/admin/test/rss', { url }),
  testWidget: (type: WidgetType, url: string) => request<TestWidgetResponse>('POST', '/api/admin/test/widget', { type, url }),
  testPrices: (zone: string, grid = '') => request<TestPricesResponse>('POST', '/api/admin/test/prices', grid ? { zone, grid } : { zone }),
  pricesToken: () => request<WeatherKeyStatus>('GET', '/api/admin/prices/token'),
  setPricesToken: (token: string) => request<WeatherKeyStatus & { checked?: boolean }>('PUT', '/api/admin/prices/token', { token }),
  testHomeAssistant: (url: string, token?: string) =>
    request<TestHomeAssistantResponse>('POST', '/api/admin/test/homeassistant', token ? { url, token } : { url }),
  /** Entities of one domain or several (the builder: grouped by area, with the builder attributes). */
  haEntities: (domain: string | readonly string[]) =>
    request<HaEntity[]>('GET', `/api/admin/homeassistant/entities?domain=${encodeURIComponent((Array.isArray(domain) ? domain : [domain]).join(','))}`),
  haStatus: () => request<HaLiveStatus>('GET', '/api/admin/homeassistant/status'),
  /** Slim states of up to 80 entities (the builder's preview of items not saved yet). */
  haSlim: (entities: string[]) => request<{ conn: 'ok' | 'down'; states: Record<string, HaSlim & { at: number; st?: string }> }>('POST', '/api/admin/homeassistant/slim', { entities }),
  /** The value of a Estadística card for the builder's preview (the screens' cache). */
  haStatistic: (entity: string, stat: string, period: string) =>
    request<HaStatistic>('GET', `/api/admin/homeassistant/statistic?entity=${encodeURIComponent(entity)}&stat=${encodeURIComponent(stat)}&period=${encodeURIComponent(period)}`),
  haHistory: (entities: string[], period: string) =>
    request<HaAdminHistory>('GET', `/api/admin/homeassistant/history?entity=${encodeURIComponent(entities.join(','))}&period=${encodeURIComponent(period)}`),
  // the token is tied to the URL typed next to it (the server sends it nowhere else)
  setHaToken: (token: string, url?: string) => request<unknown>('PUT', '/api/admin/homeassistant/token', url ? { token, url } : { token }),
  /** The builder's Probar button: one control of a card on Home Assistant (the same allowlist as the screens). */
  haAction: (body: HaAdminActionRequest) => request<{ ok: true }>('POST', '/api/admin/homeassistant/action', body),
  /** Test ring (or dismiss) with the draft settings: the screens show the camera as the webhook would. */
  doorbell: (body: DoorbellRequest) => request<DoorbellResponse>('POST', '/api/admin/doorbell', body),
  // Immich (self-hosted, features.immich): the key is write-only
  testImmich: (body: { url?: string; key?: string; insecureTls?: boolean }) => request<TestImmichResponse>('POST', '/api/admin/test/immich', body),
  immichKey: () => request<ImmichKeyStatus>('GET', '/api/admin/immich/key'),
  /** '' removes the key; a key Immich refuses answers 400 invalid_key */
  setImmichKey: (key: string) => request<ImmichKeyStatus>('PUT', '/api/admin/immich/key', { key }),
  immichAlbums: () => request<ImmichAlbum[]>('GET', '/api/admin/immich/albums'),
  immichStatus: () => request<ImmichStatus>('GET', '/api/admin/immich/status'),
  refreshImmich: () => request<ImmichStatus>('POST', '/api/admin/immich/refresh'),
  clearImmichCache: () => request<{ ok: boolean; freed: number }>('DELETE', '/api/admin/immich/cache'),
  weatherKey: () => request<WeatherKeyStatus>('GET', '/api/admin/weather/key'),
  /** '' removes the key; a key the provider refuses answers 400 key_invalid */
  setWeatherKey: (key: string) => request<WeatherKeyStatus>('PUT', '/api/admin/weather/key', { key }),

  photos: () => request<AdminPhoto[]>('GET', '/api/admin/photos'),
  deletePhoto: (file: string) => request<unknown>('DELETE', `/api/admin/photos/${encodeURIComponent(file)}`),
  checkPhotoNames: (names: string[]) => request<{ results: PhotoNameCheck[] }>('POST', '/api/admin/photos/check', { names }),
  setPhotoFocus: (file: string, focusX: number, focusY: number) =>
    request<AdminPhoto>('PATCH', `/api/admin/photos/${encodeURIComponent(file)}`, { focusX, focusY }),
  setPhotoHidden: (file: string, hidden: boolean) =>
    request<AdminPhoto>('PATCH', `/api/admin/photos/${encodeURIComponent(file)}`, { hidden }),
  setPhotosHidden: (files: string[], hidden: boolean) =>
    request<{ ok: boolean; updated: string[]; missing: string[]; total: number; inRotation: number }>('POST', '/api/admin/photos/visibility', { files, hidden }),
  refreshDisplays: (screens?: string[]) => request<unknown>('POST', '/api/admin/refresh-displays', screens?.length ? { screens } : {}),
  status: () => request<AdminStatus>('GET', '/api/admin/status'),

  // ---- v2 (docs/ARCHITECTURE.md) ----
  dashboard: () => request<DashboardResponse>('GET', '/api/admin/dashboard'),
  // updates (self-hosted, features.updates)
  updateInfo: () => request<UpdateInfo>('GET', '/api/admin/update'),
  updateSettings: (patch: Partial<UpdateSettings>) => request<UpdateInfo>('PUT', '/api/admin/update/settings', patch),
  updateCheck: () => request<UpdateInfo>('POST', '/api/admin/update/check'),
  updateApply: () => request<UpdateInfo>('POST', '/api/admin/update/apply'),
  screenTemplate: (name: string) => request<ScreenProfile>('GET', `/api/admin/screens/template${q({ name })}`),
  displays: () => request<DisplaysResponse>('GET', '/api/admin/displays'),
  // privacy mode per screen (features.privacy; docs/API.md)
  privacy: () => request<PrivacyResponse>('GET', '/api/admin/privacy'),
  setPrivacy: (body: PrivacyRequest) => request<PrivacyChangeResponse>('POST', '/api/admin/privacy', body),
  displayCommand: (body: DisplayCommandRequest) => request<{ ok: true; delivered: number }>('POST', '/api/admin/displays/command', body),
  forgetDisplay: (clientId: string) => request<{ ok: true }>('DELETE', `/api/admin/displays/${encodeURIComponent(clientId)}`),

  // ---- display access: private links, paired devices, pairing (docs/API.md "Display access") ----
  displayLinks: () => request<DisplayLinksResponse>('GET', '/api/admin/display-links'),
  regenerateLink: (screenId: string) => request<{ link: DisplayLink }>('POST', `/api/admin/display-links/${encodeURIComponent(screenId)}/regenerate`, {}),
  devices: () => request<DevicesResponse>('GET', '/api/admin/devices'),
  updateDevice: (id: string, body: { name?: string; screenId?: string }) => request<{ device: PairedDevice }>('PATCH', `/api/admin/devices/${encodeURIComponent(id)}`, body),
  revokeDevice: (id: string) => request<{ ok: true }>('DELETE', `/api/admin/devices/${encodeURIComponent(id)}`),
  claimPairing: (body: PairClaimRequest) => request<PairClaimResponse>('POST', '/api/admin/pair/claim', body),
  // Place search through the server (the setup wizard sends its setup token, there is no session yet).
  geocode: (query: string, lang: string, setupToken?: string) =>
    request<GeocodeResponse>('GET', `/api/admin/geocode${q({ q: query, lang })}`, undefined, setupToken ? { headers: { 'x-setup-token': setupToken }, silent401: true } : {}),

  // ---- Familia: what was done, stars, the family link (server/routes/family.js) ----
  family: () => request<FamilyAdminState>('GET', '/api/admin/family'),
  familyToggle: (body: { choreId: string; done: boolean; date?: string }) => request<{ ok: true; state: FamilyAdminState }>('POST', '/api/admin/family/toggle', body),
  familyAdjust: (body: { memberId: string; delta: number; note?: string }) => request<{ ok: true; state: FamilyAdminState }>('POST', '/api/admin/family/adjust', body),
  familyRedeem: (body: { rewardId: string; memberId: string; force?: boolean }) => request<{ ok: true; state: FamilyAdminState }>('POST', '/api/admin/family/redeem', body),
  familyUndo: (kind: 'redemption' | 'adjustment', id: string) =>
    request<{ ok: true; state: FamilyAdminState }>('DELETE', `/api/admin/family/${kind === 'redemption' ? 'redemptions' : 'adjustments'}/${encodeURIComponent(id)}`),
  familyLink: () => request<{ link: FamilyAdminState['link'] }>('POST', '/api/admin/family/link', {}),
  revokeFamilyLink: () => request<{ ok: true }>('DELETE', '/api/admin/family/link'),
  /** A cropped profile photo (base64 of a small square JPEG): its id, for family.members[].photo. */
  familyPhoto: (data: string) => request<{ photo: string }>('POST', '/api/admin/family/photos', { data }),

  eventsPreview: (body: EventsPreviewRequest) => request<EventsPreviewResponse>('POST', '/api/admin/events/preview', body),
  parseBirthdaysCsv: (text: string) => request<BirthdayCsvResult>('POST', '/api/admin/birthdays/parse-csv', { text }),
  countdowns: (screen: string) => request<CountdownsResponse>('GET', `/api/admin/countdowns${q({ screen })}`),

  announce: (body: AnnounceRequest) => request<AnnounceResponse>('POST', '/api/admin/announce', body),
  announcements: () => request<AnnouncementsResponse>('GET', '/api/admin/announcements'),
  clearAnnouncement: (id: string) => request<{ ok: true }>('DELETE', `/api/admin/announcements/${encodeURIComponent(id)}`),
  clearAnnouncements: () => request<{ ok: true; cleared: number }>('DELETE', '/api/admin/announcements'),

  tokens: () => request<ApiTokenInfo[]>('GET', '/api/admin/tokens'),
  createToken: (name: string, scopes?: TokenScope[]) => request<ApiTokenCreated>('POST', '/api/admin/tokens', scopes ? { name, scopes } : { name }),
  setTokenScopes: (id: string, scopes: TokenScope[]) => request<ApiTokenInfo>('PATCH', `/api/admin/tokens/${encodeURIComponent(id)}`, { scopes }),
  /** values pushed by POST /api/hooks/values (the builder's key picker, the API page) */
  hookValues: () => request<{ values: HookValueInfo[] }>('GET', '/api/admin/values'),
  // data cards (market, sports, stocks): pickers, the builder's preview and the Finnhub key (server/routes/data.js)
  dataCoins: (q: string) => request<CoinSearchResult>('GET', `/api/admin/data/coins?q=${encodeURIComponent(q)}`),
  dataLeagues: () => request<SportsLeaguesResult>('GET', '/api/admin/data/sports/leagues'),
  dataTeams: (league: string, q = '') => request<SportsTeamsResult>('GET', `/api/admin/data/sports/teams?league=${encodeURIComponent(league)}&q=${encodeURIComponent(q)}`),
  dataSymbols: (q: string) => request<SymbolSearchResult>('GET', `/api/admin/data/stocks/symbols?q=${encodeURIComponent(q)}`),
  dataPreview: (body: DataPreviewRequest) => request<DataPreviewResponse>('POST', '/api/admin/data/preview', body),
  stocksKey: () => request<StocksKeyStatus>('GET', '/api/admin/data/stocks/key'),
  putStocksKey: (key: string) => request<StocksKeyStatus>('PUT', '/api/admin/data/stocks/key', { key }),
  deleteHookValue: (key: string) => request<{ ok: true }>('DELETE', `/api/admin/values/${encodeURIComponent(key)}`),
  revokeToken: (id: string) => request<{ ok: true }>('DELETE', `/api/admin/tokens/${encodeURIComponent(id)}`),

  backups: () => request<BackupInfo[]>('GET', '/api/admin/backups'),
  createBackup: () => request<BackupInfo>('POST', '/api/admin/backups', {}),
  backupUrl: (id: string) => `/api/admin/backups/${encodeURIComponent(id)}`,
  /** A backup file's content (a 401 here, as for every call, sends the admin through sign in again first). */
  backupFile: (id: string) => request<unknown>('GET', `/api/admin/backups/${encodeURIComponent(id)}`),
  restoreBackup: (id: string) => request<{ ok: true; config: StoredConfig; repaired?: string[] }>('POST', `/api/admin/backups/${encodeURIComponent(id)}/restore`, {}),
  deleteBackup: (id: string) => request<{ ok: true }>('DELETE', `/api/admin/backups/${encodeURIComponent(id)}`),
  exportConfig: (includeSecrets: boolean, password?: string) => request<ExportBundle>('POST', '/api/admin/export', { includeSecrets, ...(password ? { password } : {}) }),
  importPreview: (bundle: unknown) => request<ImportPreview>('POST', '/api/admin/import/preview', { bundle, lang: getLang() }),
  importApply: (body: ImportApplyRequest) => request<{ ok: true; config: StoredConfig; loggedOut?: boolean }>('POST', '/api/admin/import/apply', body),

  activity: (params: { type?: string; level?: string; q?: string; actor?: string; before?: string; limit?: number }) =>
    request<ActivityResponse>('GET', `/api/admin/activity${q(params)}`),
  clearActivity: () => request<{ ok: true }>('DELETE', '/api/admin/activity'),
};

/** Trigger a browser download of a JSON value (export uses POST, so no plain link). */
export function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function xhrUpload<T>(method: string, url: string, fd: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-Requested-With', 'fetch');
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve(data as T);
      } else {
        if (xhr.status === 401) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
        reject(new ApiError(xhr.status, apiErrorMessage(xhr.status, data), data));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'network'));
    xhr.send(fd);
  });
}

export interface PhotoUpload {
  blob: Blob;
  name: string;
  thumb?: Blob;
  focusX?: number;
  focusY?: number;
}

/**
 * Multipart upload (XHR for progress). Field `photos[]` as documented in docs/API.md, optional `thumbs[]` (same order) and `meta`
 * (focal points). `onConflict` decides what happens when the name is taken (server default: rename).
 */
export function uploadPhotos(
  files: PhotoUpload[],
  onConflict: PhotoConflictPolicy = 'rename',
  onProgress?: (fraction: number) => void
): Promise<PhotoUploadResult> {
  const fd = new FormData();
  fd.append('meta', JSON.stringify(files.map((f) => (f.focusX !== undefined && f.focusY !== undefined ? { focusX: f.focusX, focusY: f.focusY } : null))));
  for (const f of files) {
    fd.append('photos[]', f.blob, f.name);
    if (f.thumb) fd.append('thumbs[]', f.thumb, 'thumb.jpg');
  }
  return xhrUpload('POST', `/api/admin/photos?onConflict=${onConflict}`, fd, onProgress);
}

/**
 * Test ring with a picture, for servers that show uploaded snapshots (features.doorbellLive off): the same multipart
 * form a Home Assistant automation sends to POST /api/hooks/doorbell (`image` plus the request fields).
 */
export function doorbellWithImage(body: DoorbellRequest, image: Blob): Promise<DoorbellResponse> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) if (v !== undefined) fd.append(k, Array.isArray(v) ? v.join(',') : String(v));
  fd.append('image', image, 'doorbell.jpg');
  return xhrUpload('POST', '/api/admin/doorbell', fd);
}

/** Thumbnail for a photo already in the gallery. */
export function uploadThumb(file: string, thumb: Blob): Promise<AdminPhoto> {
  const fd = new FormData();
  fd.append('thumb', thumb, 'thumb.jpg');
  return xhrUpload('PUT', `/api/admin/photos/${encodeURIComponent(file)}/thumb`, fd);
}
