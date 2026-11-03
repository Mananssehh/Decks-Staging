import { describe, it, expect, vi } from "vitest";
import { useEffect } from "react";
import { renderHook } from "@testing-library/react";
import { useStableGuestScope, type GuestSearchScope } from "./useStableGuestScope";

describe("RequestPicker guest search scope", () => {
  it("does not repeat search on unrelated queue/profile refresh, only on event/token change", () => {
    const search = vi.fn(); // stands in for the provider search; no network
    const { rerender } = renderHook(({ scope }: { scope?: GuestSearchScope; queue: number }) => {
      const stable = useStableGuestScope(scope);
      useEffect(() => { search("x", stable); }, [stable]);
    }, { initialProps: { scope: { event_id: "e1", token: "a".repeat(64) }, queue: 0 } });
    for (let i = 1; i <= 5; i++) rerender({ scope: { event_id: "e1", token: "a".repeat(64) }, queue: i });
    expect(search).toHaveBeenCalledTimes(1);
    rerender({ scope: { event_id: "e1", token: "b".repeat(64) }, queue: 6 });
    expect(search).toHaveBeenCalledTimes(2);
    rerender({ scope: { event_id: "e2", token: "b".repeat(64) }, queue: 7 });
    expect(search).toHaveBeenCalledTimes(3);
    rerender({ scope: undefined, queue: 8 });
    expect(search).toHaveBeenCalledTimes(4);
    expect(search).toHaveBeenLastCalledWith("x", undefined);
  });
});
