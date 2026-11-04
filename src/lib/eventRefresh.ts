import {beginMonitoring} from './monitoring';
import {classifyFailure} from './monitoringPolicy';
/** Coalesces bursts and discards responses invalidated by newer events or mutations. */
export function createEventRefresh<T>(load: () => Promise<T>, apply: (value: T) => void, busy: () => boolean) {
  let revision = 0;
  let running = false;
  let dirty = false;
  let disposed = false;
  const refresh = async (): Promise<void> => {
    if (disposed) return;
    dirty = true;
    revision++;
    if (running || busy()) return;
    running = true;
    try {
      while (dirty && !disposed && !busy()) {
        dirty = false;
        const ticket = revision;
        const finish=beginMonitoring('stream_update');
        try {
          const value = await load();
          if (!disposed && ticket === revision && !busy()) apply(value);
          finish();
        } catch (error) {
          if(!disposed){const c=classifyFailure(error);finish(c.category,c.status);}
          // Leave last good state; a later reconnect retries, never empty it on errors.
        }
      }
    } finally { running = false; }
  };
  return { refresh, invalidate: () => { revision++; dirty = true; }, dispose: () => { disposed = true; revision++; } };
}

export function listenEventRefresh(eventId: string, userId: string, refresh: () => void) {
  const key = `decks:event:${eventId}:${userId}`;
  const visible = () => { if (document.visibilityState === "visible") refresh(); };
  const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) refresh(); };
  window.addEventListener("online", refresh);
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener("online", refresh);
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("storage", storage);
  };
}

export function notifyEventChange(eventId: string, userId: string) {
  try { localStorage.setItem(`decks:event:${eventId}:${userId}`, crypto.randomUUID()); } catch { /* Private mode: reconnect remains available. */ }
}