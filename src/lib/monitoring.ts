import * as Sentry from '@sentry/react';
type Envelope = [Record<string,unknown>, Array<[ {type:string}, unknown ]>];
type CleanEnvelope = [{event_id:string;sent_at:string}, Array<[{type:'event'},Sentry.Event]>];
import { monitoringEnabled, sanitizeEvent, safeSignal, classifyFailure, outage, type MonitorAction, type MonitorCategory, type MonitorSignal } from './monitoringPolicy';

/** Ten queued signals, ten accepted/minute, same action/category once/30s. No persistence/retry. */
export function createReporter(send: (signal: MonitorSignal) => void, enabled: boolean, now = Date.now) {
  let windowStart = now(), count = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const recent = new Map<string, number>(), queue: MonitorSignal[] = [];
  const report = (input: MonitorSignal) => {
    try {
      if (!enabled) return;
      const signal = safeSignal(input); if (!signal) return;
      const time = now(); if (time - windowStart >= 60000) { windowStart = time; count = 0; recent.clear(); }
      const key = `${signal.action}:${signal.category}`;
      if (count >= 10 || queue.length >= 10 || (recent.has(key) && time - (recent.get(key) ?? 0) < 30000)) return;
      count++; recent.set(key,time); queue.push(signal);
      if (!timer) timer = setTimeout(() => { timer = undefined; for (const s of queue.splice(0)) { try { send(s); } catch { /* telemetry never affects app */ } } }, 0);
    } catch { /* fail closed */ }
  };
  return report;
}
let reportSignal: (signal: MonitorSignal) => void = () => undefined;
let initialized = false;
/** Final wire gate drops ALL non-event items, including spans, sessions and attachments. */
export function safeEnvelope(envelope: Envelope): CleanEnvelope {
  const items: CleanEnvelope[1] = [];
  for (const [header, payload] of envelope[1]) {
    if (header.type !== 'event' || !payload || typeof payload !== 'object') continue;
    const event = sanitizeEvent(payload as Sentry.Event);
    if (event) items.push([{type:'event'},event]);
  }
  return [{event_id:items[0]?.[1].event_id ?? '',sent_at:new Date().toISOString()},items];
}
export function initMonitoring(backend: unknown = import.meta.env.VITE_SUPABASE_PROJECT_ID, dsn: unknown = import.meta.env.VITE_SENTRY_DSN) {
  if (initialized || !monitoringEnabled(backend,dsn) || typeof dsn !== 'string') return false;
  try {
    const options: Parameters<typeof Sentry.init>[0] & {sendDefaultPii:false} = {
      dsn, environment:'staging', defaultIntegrations:false, integrations:[], sendDefaultPii:false,
      ...(typeof import.meta.env.VITE_SENTRY_RELEASE === 'string' && /^[a-f0-9]{7,40}$/.test(import.meta.env.VITE_SENTRY_RELEASE) ? {release:`decks-staging@${import.meta.env.VITE_SENTRY_RELEASE}`} : {}),
      maxBreadcrumbs:0, beforeBreadcrumb:() => null, attachStacktrace:false,
      tracesSampleRate:0, tracePropagationTargets:[], sendClientReports:false,
      beforeSend:event => sanitizeEvent(event), beforeSendTransaction:() => null,
      transport:options => {
        const transport = Sentry.makeFetchTransport({...options,bufferSize:10,fetchOptions:{credentials:'omit',referrerPolicy:'no-referrer'}});
        return {flush:transport.flush, send:envelope => {
          const safe = safeEnvelope(envelope);
          return safe[1].length ? transport.send(safe) : Promise.resolve({});
        }};
      },
    };
    Sentry.init(options);
    initialized = true;
    reportSignal = createReporter(signal => Sentry.captureEvent({tags:{action:signal.action,category:signal.category},extra:{status:signal.status,duration:signal.duration}}),true);
    // Static framework categories only: no Error object, stack, reason, or filename enters Sentry.
    window.addEventListener('error', () => reportMonitoring('framework','framework'));
    window.addEventListener('unhandledrejection', () => reportMonitoring('framework','framework'));
    return true;
  } catch { return false; }
}
export function reportMonitoring(action: MonitorAction, category: MonitorCategory, duration?: number, status?: number) {
  try { reportSignal({action,category,duration,status}); } catch { /* no effect on operation */ }
}
export function beginMonitoring(action: MonitorAction) {
  const start = performance.now(); let ended = false;
  return (category: MonitorCategory = 'success', status?: number) => {
    if (ended) return; ended = true;
    const duration = performance.now() - start;
    if (category === 'business_rejection') return;
    if (outage(category) || action === 'join' || action === 'song_request') reportMonitoring(action,category,duration,status);
    if (!outage(category) && duration >= 3000) reportMonitoring(action,'delay',duration,status);
  };
}
export async function monitored<T>(action: MonitorAction, operation: () => Promise<T>): Promise<T> {
  const finish = beginMonitoring(action);
  try { const result = await operation(); finish(); return result; }
  catch (error) { const c = classifyFailure(error); finish(c.category,c.status); throw error; }
}