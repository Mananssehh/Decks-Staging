import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const m = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn(), invoke: vi.fn(), signup: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: m.getSession, signInAnonymously: m.signup }, rpc: m.rpc, functions: { invoke: m.invoke } },
}));
vi.mock("@/contexts/auth-state", () => ({ useAuth: () => ({ user: null, profile: null, isAnonymous: false, loading: false, refreshProfile: vi.fn() }) }));
vi.mock("@/contexts/guest-state", () => ({ useGuest: () => ({ enabled: true, join: vi.fn() }) }));
vi.mock("@/components/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/components/SiteFooter", () => ({ SiteFooter: () => null }));
vi.mock("@/components/SEO", () => ({ SEO: () => null }));

const DEFAULTS = { enabled: true, prompt_at: 3, require_at: 4, bonus_points: 0 };
const load = async () => { vi.resetModules(); return import("./useGuestJoinLimits"); };

beforeEach(() => {
  m.rpc.mockReset().mockResolvedValue({ data: { require_at: 9 }, error: null });
  m.getSession.mockReset().mockResolvedValue({ data: { session: null } });
  m.invoke.mockReset(); m.signup.mockReset();
});

it("signed-out /join load makes no restricted RPC request", async () => {
  vi.resetModules();
  const { default: Join } = await import("@/pages/Join");
  render(<MemoryRouter initialEntries={["/join?code=ROOM1"]}><Join /></MemoryRouter>);
  expect(await screen.findByLabelText(/nickname/i)).toBeInTheDocument();
  await waitFor(() => expect(m.getSession).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.invoke).not.toHaveBeenCalled();
  expect(m.signup).not.toHaveBeenCalled();
});

it("signed out: safe defaults and zero count without calling either RPC", async () => {
  const { fetchGuestJoinLimits, fetchGuestEventCount } = await load();
  expect(await fetchGuestJoinLimits()).toEqual(DEFAULTS);
  expect(await fetchGuestEventCount()).toBe(0);
  expect(m.rpc).not.toHaveBeenCalled();
});

it("signed-out defaults are not cached: a later signed-in read loads real limits once", async () => {
  const { fetchGuestJoinLimits } = await load();
  expect(await fetchGuestJoinLimits()).toEqual(DEFAULTS);
  m.getSession.mockResolvedValue({ data: { session: { user: { id: "u" } } } });
  expect(await fetchGuestJoinLimits()).toEqual({ ...DEFAULTS, require_at: 9 });
  expect(await fetchGuestJoinLimits()).toEqual({ ...DEFAULTS, require_at: 9 });
  expect(m.rpc).toHaveBeenCalledTimes(1);
  expect(m.rpc).toHaveBeenCalledWith("get_guest_join_limits");
});

it("signed in: event count still uses the RPC", async () => {
  m.getSession.mockResolvedValue({ data: { session: { user: { id: "u" } } } });
  m.rpc.mockResolvedValue({ data: 2, error: null });
  const { fetchGuestEventCount } = await load();
  expect(await fetchGuestEventCount()).toBe(2);
  expect(m.rpc).toHaveBeenCalledWith("get_guest_event_count");
});

it("session lookup failure falls back to defaults without an RPC", async () => {
  m.getSession.mockRejectedValue(new Error("storage unavailable"));
  const { fetchGuestJoinLimits } = await load();
  expect(await fetchGuestJoinLimits()).toEqual(DEFAULTS);
  expect(m.rpc).not.toHaveBeenCalled();
});
