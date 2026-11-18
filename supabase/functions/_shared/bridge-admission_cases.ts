// Runner-neutral cases for the per-worker pending-claim limit (registered by
// bridge-admission_test.ts under Deno and by src/test/bridgePairingV2.test.ts under Vitest).
// Deterministic: every pending call is a promise the test settles by hand; no clock is used.
import { PROVISIONAL_PENDING_CLAIM_LIMIT, createPendingCallLimit } from './bridge-admission.ts';
import { equal, ok, type Case } from './bridge-protocol_cases.ts';

export interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
/** Lets every already-queued promise reaction run, plus one macrotask turn. */
export const settle = () => new Promise<void>((done) => setTimeout(done, 0));

export const admissionCases: readonly Case[] = [
  ['the provisional default is four pending calls', async () => {
    equal(PROVISIONAL_PENDING_CLAIM_LIMIT, 4);
    equal(createPendingCallLimit().limit, 4);
  }],
  ['the limit must be a positive integer', async () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      let threw = false;
      try { createPendingCallLimit(bad); } catch (error) { threw = error instanceof RangeError; }
      ok(threw, `limit ${bad}`);
    }
  }],
  ['a full limit refuses without starting the call and without queueing', async () => {
    const limit = createPendingCallLimit(4);
    const held = Array.from({ length: 4 }, () => deferred<string>());
    for (const d of held) ok(limit.tryRun(() => d.promise) !== null, 'admitted');
    equal(limit.pending(), 4);
    let started = 0;
    equal(limit.tryRun(async () => { started += 1; return 'x'; }), null);
    equal(started, 0, 'refused call never starts');
    held[0].resolve('done');
    await settle();
    equal(limit.pending(), 3, 'a refused call left nothing queued behind it');
    equal(started, 0);
  }],
  ['the call’s own promise is returned unchanged in value and rejection', async () => {
    const limit = createPendingCallLimit(1);
    equal(await limit.tryRun(async () => 'value'), 'value');
    let caught: unknown;
    try { await limit.tryRun(async () => { throw new Error('upstream'); }); } catch (error) { caught = error; }
    ok(caught instanceof Error && caught.message === 'upstream', 'rejection passes through');
  }],
  ['a slot is released when the call resolves', async () => {
    const limit = createPendingCallLimit(1);
    const d = deferred<number>();
    const run = limit.tryRun(() => d.promise);
    equal(limit.tryRun(async () => 0), null, 'full while pending');
    d.resolve(1);
    equal(await run, 1);
    equal(limit.pending(), 0, 'free by the time the caller sees the result');
  }],
  ['a slot is released when the call rejects', async () => {
    const limit = createPendingCallLimit(1);
    const d = deferred<number>();
    const run = limit.tryRun(() => d.promise)!;
    d.reject(new Error('boom'));
    await run.catch(() => {});
    equal(limit.pending(), 0);
  }],
  ['a call that throws synchronously frees its slot immediately, before its rejection is awaited', async () => {
    const limit = createPendingCallLimit(1);
    const run = limit.tryRun((() => { throw new Error('sync'); }) as () => Promise<never>);
    ok(run !== null, 'admitted');
    equal(limit.pending(), 0, 'free synchronously, with no microtask turn in between');
    ok(limit.tryRun(async () => 'next') !== null, 'the next call is admitted at once');
    let caught: unknown;
    try { await run; } catch (error) { caught = error; }
    ok(caught instanceof Error && caught.message === 'sync', 'the synchronous error is still delivered as a rejection');
    await settle();
    equal(limit.pending(), 0);
  }],
  ['each slot is released exactly once', async () => {
    const limit = createPendingCallLimit(2);
    const a = deferred<string>(), b = deferred<string>();
    const ra = limit.tryRun(() => a.promise)!, rb = limit.tryRun(() => b.promise)!;
    a.resolve('a');
    a.resolve('again');
    a.reject(new Error('late'));
    await ra;
    await settle();
    equal(limit.pending(), 1, 'settling one call twice frees one slot, not two');
    ok(limit.tryRun(() => deferred<string>().promise) !== null, 'one slot free');
    equal(limit.tryRun(async () => 'x'), null, 'and only one');
    b.resolve('b');
    await rb;
  }],
  ['only settlement frees a slot: time passing does not', async () => {
    const limit = createPendingCallLimit(1);
    const d = deferred<string>();
    limit.tryRun(() => d.promise);
    for (let i = 0; i < 5; i++) await settle();
    equal(limit.pending(), 1);
    equal(limit.tryRun(async () => 'x'), null);
    d.resolve('late');
    await settle();
    equal(limit.pending(), 0);
  }],
  ['separate limits share nothing (one per worker)', async () => {
    const a = createPendingCallLimit(1), b = createPendingCallLimit(1);
    a.tryRun(() => deferred<void>().promise);
    equal(a.tryRun(async () => {}), null);
    ok(b.tryRun(async () => {}) !== null, 'other limit unaffected');
  }],
];
