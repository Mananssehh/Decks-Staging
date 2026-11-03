import { useMemo } from "react";
export type GuestSearchScope = { event_id: string; token: string };
/** Returns the same object while event_id/token are unchanged, so search effects do not re-run on unrelated refreshes. */
export function useStableGuestScope(scope?: GuestSearchScope): GuestSearchScope | undefined {
  const event = scope?.event_id, token = scope?.token;
  return useMemo(() => (event && token ? { event_id: event, token } : undefined), [event, token]);
}
