import { describe, it, expect, vi } from "vitest";
import { createEventRefresh, listenEventRefresh } from "./eventRefresh";
const deferred = <T,>() => { let resolve: (value: T) => void = () => undefined; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
describe("event reconnect synchronization", () => {
  it("discards a pre-vote snapshot, defers during optimism, then applies authoritative lifecycle/settings/votes", async () => {
    const old = deferred<object>(); let busy = false;
    const authoritative = { songs: [{id:"s",upvotes:2}], event: {requests_status:"ended",allow_explicit:false}, votes:{s:-1} };
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(authoritative);
    const apply = vi.fn(); const refresh = createEventRefresh(load,apply,()=>busy);
    const flight = refresh.refresh(); busy = true; refresh.invalidate();
    old.resolve({votes:{s:1}}); await flight;
    expect(apply).not.toHaveBeenCalled(); busy=false; await refresh.refresh();
    expect(apply).toHaveBeenCalledExactlyOnceWith(authoritative);
  });
  it("coalesces repeated reconnect events and never overwrites a newer snapshot", async () => {
    const first=deferred<number>(); const load=vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(2); const apply=vi.fn();
    const sync=createEventRefresh(load,apply,()=>false); const pending=sync.refresh();
    void sync.refresh(); void sync.refresh(); first.resolve(1); await pending;
    expect(load).toHaveBeenCalledTimes(2); expect(apply).toHaveBeenCalledExactlyOnceWith(2);
  });
  it("cleans listeners, scopes cross-tab changes, and refreshes online/visible", () => {
    const refresh=vi.fn(); const cleanup=listenEventRefresh("e","u",refresh);
    window.dispatchEvent(new StorageEvent("storage",{key:"unrelated"})); expect(refresh).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent("storage",{key:"decks:event:e:u"})); window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange")); expect(refresh).toHaveBeenCalledTimes(3);
    cleanup(); window.dispatchEvent(new Event("online")); expect(refresh).toHaveBeenCalledTimes(3);
  });
  it("never applies after disposal or on failed reads", async () => {
    const pending=deferred<number>(); const apply=vi.fn(); const sync=createEventRefresh(()=>pending.promise,apply,()=>false);
    const flight=sync.refresh(); sync.dispose(); pending.resolve(1); await flight; expect(apply).not.toHaveBeenCalled();
    await createEventRefresh(async()=>{throw Error("offline")},apply,()=>false).refresh(); expect(apply).not.toHaveBeenCalled();
  });
});