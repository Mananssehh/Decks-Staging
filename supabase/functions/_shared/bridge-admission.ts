// DECKS Bridge Pairing Protocol v2 — per-worker pending-claim limit for bridge-pair.
// Contract: docs/BRIDGE_PAIRING_PROTOCOL_V2.md ("Pending-claim limit"). SDK-free, no timers,
// no storage, no network, no logging. Nothing here ever sees a pairing code, nonce or token.
//
// This is database backpressure, not request-volume limiting: it bounds how many claim calls
// one worker has outstanding at once. It is not shared between workers, keeps no counter of
// past requests or failures, and starts empty whenever a worker starts.
//
// A slot is held from the moment the claim call starts until the promise that call returned
// settles, and it is released exactly once. A call that throws before returning a promise has
// already finished, so its slot is released before tryRun returns. Nothing else releases it: not a caller
// disconnect, not an aborted request, not a timer. If a claim call never settles, its slot
// stays taken for the life of the worker; enough hung calls make that worker answer every
// valid claim with 503 until the platform replaces it. That is deliberate: freeing a slot
// while its call is still running would let unbounded concurrent calls pile onto Postgres.

/** Provisional, uncalibrated default: four pending claim calls per worker. */
export const PROVISIONAL_PENDING_CLAIM_LIMIT = 4;

export interface PendingCallLimit {
  readonly limit: number;
  /** Calls started through this limit whose promises have not settled yet. */
  pending(): number;
  /**
   * Starts `call` only when a slot is free and returns its own promise. Returns null, without
   * starting `call`, when every slot is taken: there is no queue and no waiting.
   */
  tryRun<T>(call: () => Promise<T>): Promise<T> | null;
}

export function createPendingCallLimit(limit: number = PROVISIONAL_PENDING_CLAIM_LIMIT): PendingCallLimit {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('pending call limit must be a positive integer');
  let pending = 0;
  return {
    limit,
    pending: () => pending,
    tryRun<T>(call: () => Promise<T>): Promise<T> | null {
      if (pending >= limit) return null;
      pending += 1;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        pending -= 1;
      };
      let settled: Promise<T>;
      try {
        settled = Promise.resolve(call());
      } catch (error) {
        // Thrown before returning a promise: nothing is pending, so free the slot now, not later.
        release();
        return Promise.reject(error);
      }
      // Registered before the caller can attach its own handlers, so the slot is free again by
      // the time the caller observes the outcome. This derived promise never rejects.
      settled.then(release, release);
      return settled;
    },
  };
}
