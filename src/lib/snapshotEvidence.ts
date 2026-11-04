/** Record the actual read start, not a caller's later coalesced wait. Never exported in a DTO. */
const starts = new WeakMap<object,number>();
export function recordSnapshotStart<T extends object>(snapshot:T,started:number):T {starts.set(snapshot,started);return snapshot;}
export function snapshotReadStarted(snapshot:object) {return starts.get(snapshot) ?? 0;}