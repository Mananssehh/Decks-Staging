import { reportMonitoring } from './monitoring';
/** IDs stay in bounded page-local memory only. No clock alone implies failure or delivery. */
export function createRequestVisibility(now = Date.now, report = reportMonitoring) {
  const pending = new Map<string, {at:number;reported:boolean}>();
  return {
    acknowledge(id:unknown, outcome:unknown) {
      if (typeof id !== 'string' || !id || !['created','supported_existing','already_supported'].includes(String(outcome))) return;
      if (pending.size >= 20) pending.delete(pending.keys().next().value ?? '');
      pending.set(id,{at:now(),reported:false});
    },
    observe(songs: readonly {id:string}[], readStarted:number, ended = false) {
      const time = now();
      for (const [id,p] of pending) {
        if (ended || time - p.at > 30000) {pending.delete(id);continue;}
        if (readStarted <= p.at) continue; // stale/in-flight pre-ack read is not evidence
        if (songs.some(s => s.id === id)) {report('request_visibility','snapshot_observed',time-p.at);pending.delete(id);}
        else if (time-p.at >= 5000 && !p.reported) {p.reported=true;report('request_visibility','snapshot_missing',time-p.at);}
      }
    },
    clear:() => pending.clear(),
  };
}