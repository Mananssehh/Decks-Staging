/** No identity, URL, free-form error, or payload is accepted by this contract. */
export const MONITORING_BACKEND = 'ldxgejbzmpvsvozqmpfe';
export const ACTIONS = ['join', 'music_search', 'song_request', 'vote', 'snapshot', 'stream_update', 'request_visibility', 'framework', 'synthetic'] as const;
export type MonitorAction = typeof ACTIONS[number];
export const CATEGORIES = ['success', 'business_rejection', 'transport', 'server', 'invalid_response', 'unknown', 'delay', 'snapshot_observed', 'snapshot_missing', 'framework'] as const;
export type MonitorCategory = typeof CATEGORIES[number];
export interface MonitorSignal { action: MonitorAction; category: MonitorCategory; status?: number; duration?: number }
export function monitoringEnabled(backend: unknown, dsn: unknown) {
  if (backend !== MONITORING_BACKEND || typeof dsn !== 'string' || !dsn.trim()) return false;
  try { const u = new URL(dsn); return u.protocol === 'https:' && !!u.username && !u.password && /^\/[0-9]+$/.test(u.pathname) && !u.search && !u.hash; } catch { return false; }
}
const business = new Set(['cooldown', 'explicit_not_allowed', 'blocked', 'invalid_track', 'unavailable', 'already_supported', 'duplicate', 'legacy_duplicate_conflict', 'ended', 'event_ended', 'invalid_input', 'rate_limited']);
/** Only typed fields are examined. Error.message/details/hint/body are never read. */
export function classifyFailure(error: unknown): { category: MonitorCategory; status?: number } {
  const e = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const ctx = e.context instanceof Response ? e.context : undefined;
  const raw = ctx?.status ?? e.status;
  const status = typeof raw === 'number' && Number.isInteger(raw) && raw >= 100 && raw <= 599 ? raw : undefined;
  if (status && status >= 500) return { category: 'server', status };
  if (status && status >= 400) return { category: 'business_rejection', status };
  if (typeof e.code === 'string' && business.has(e.code)) return { category: 'business_rejection', status };
  if (e.code === 'invalid_response') return { category: 'invalid_response', status };
  if (e.code === '57014' || e.code === '55P03' || e.code === 'upstream_unavailable' || e.code === 'service_unavailable') return { category: 'server', status };
  if (typeof e.code === 'string' && (/^22/.test(e.code) || e.code === '23505' || e.code === '42501' || e.code === 'P0001')) return { category: 'business_rejection', status };
  if (error instanceof TypeError || e.name === 'FunctionsFetchError' || e.name === 'FunctionsRelayError') return { category: 'transport', status };
  return { category: 'unknown', status };
}
export function outcomeCategory(outcome: unknown): MonitorCategory {
  if (outcome === 'created' || outcome === 'supported_existing') return 'success';
  if (typeof outcome === 'string' && business.has(outcome)) return 'business_rejection';
  return 'invalid_response';
}
export function outage(category: MonitorCategory) { return ['server', 'transport', 'invalid_response', 'unknown', 'framework'].includes(category); }
export function safeSignal(input: unknown): MonitorSignal | null {
  if (!input || typeof input !== 'object') return null;
  const s = input as Record<string, unknown>;
  if (!ACTIONS.includes(s.action as MonitorAction) || !CATEGORIES.includes(s.category as MonitorCategory)) return null;
  return { action: s.action as MonitorAction, category: s.category as MonitorCategory,
    ...(typeof s.status === 'number' && Number.isInteger(s.status) && s.status >= 100 && s.status <= 599 ? {status:s.status} : {}),
    ...(typeof s.duration === 'number' && Number.isFinite(s.duration) ? {duration:Math.round(Math.max(0, Math.min(s.duration, 120000)))} : {}) };
}
/** Reconstruct, do not blacklist: even unknown future SDK fields are discarded. */
export function sanitizeEvent(input: { tags?: Record<string, unknown>; extra?: Record<string, unknown>; event_id?: string; timestamp?: number }) {
  const signal = safeSignal({action:input.tags?.action, category:input.tags?.category, status:input.extra?.status, duration:input.extra?.duration});
  if (!signal) return null;
  return {
    ...(typeof input.event_id === 'string' && /^[a-f0-9]{32}$/.test(input.event_id) ? {event_id:input.event_id} : {}),
    ...(typeof input.timestamp === 'number' && Number.isFinite(input.timestamp) ? {timestamp:input.timestamp} : {}),
    environment:'staging', platform:'javascript', message:`decks.${signal.action}.${signal.category}`,
    level:outage(signal.category) ? 'error' as const : signal.category === 'delay' || signal.category === 'snapshot_missing' ? 'warning' as const : 'info' as const,
    fingerprint:['decks',signal.action,signal.category], tags:{action:signal.action,category:signal.category},
    extra:{...(signal.status ? {status:signal.status} : {}), ...(signal.duration !== undefined ? {duration:signal.duration} : {})},
  };
}