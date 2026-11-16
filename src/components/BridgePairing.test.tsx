import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { BridgePairing } from "./BridgePairing";

const m = vi.hoisted(() => ({ rpc: vi.fn(), success: vi.fn(), error: vi.fn(), write: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: m.rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: m.success, error: m.error } }));

const EVENT = "11111111-2222-4333-8444-555555555555";
const GROUPED = "GHJK-MNPQ-RSTV-WXYZ";
const CANONICAL = "GHJKMNPQRSTVWXYZ";
const inFiveMinutes = () => new Date(Date.now() + 5 * 60 * 1000).toISOString();
const reply = (code: unknown, expires_at: string = inFiveMinutes()) => ({ data: [{ code, expires_at }], error: null });

beforeEach(() => {
  m.rpc.mockReset(); m.success.mockReset(); m.error.mockReset(); m.write.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: m.write } });
  localStorage.clear(); sessionStorage.clear();
});

const generate = async (code: unknown, expires_at?: string) => {
  m.rpc.mockResolvedValue(reply(code, expires_at));
  const view = render(<BridgePairing eventId={EVENT} />);
  fireEvent.click(screen.getByRole("button", { name: /connect decks bridge/i }));
  await waitFor(() => expect(m.rpc).toHaveBeenCalledWith("generate_bridge_pairing_code", { _event_id: EVENT }));
  return view;
};

it("displays the grouped 16-character code with Protocol v2 instructions", async () => {
  await generate(GROUPED);
  expect((await screen.findByTestId("bridge-pairing-code")).textContent).toBe(GROUPED);
  expect(screen.getByText(/enter this 16-character code/i)).toBeInTheDocument();
  expect(screen.queryByText(/6-digit/i)).toBeNull();
});

it("groups a canonical code from the backend before display", async () => {
  await generate(CANONICAL);
  expect((await screen.findByTestId("bridge-pairing-code")).textContent).toBe(GROUPED);
});

it("copies the grouped code", async () => {
  await generate(GROUPED);
  await screen.findByTestId("bridge-pairing-code");
  fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
  await waitFor(() => expect(m.write).toHaveBeenCalledWith(GROUPED));
  fireEvent.click(screen.getByRole("button", { name: /copy pairing code/i }));
  await waitFor(() => expect(m.write).toHaveBeenCalledTimes(2));
  expect(m.write.mock.calls.every(([value]) => value === GROUPED)).toBe(true);
});

it("renders no QR code, link, deep link or other URL carrying the code", async () => {
  const { container } = await generate(GROUPED);
  await screen.findByTestId("bridge-pairing-code");
  expect(container.querySelector("a, details, canvas, img, iframe")).toBeNull();
  expect(screen.queryByText(/qr/i)).toBeNull();
  const html = container.innerHTML;
  for (const needle of ["linku99", "connect?code", "decksbridge:", "href="]) expect(html).not.toContain(needle);
  expect(html.split(GROUPED).length - 1).toBe(1);
  expect(html).not.toContain(CANONICAL);
  expect(window.location.href).not.toContain(GROUPED);
  expect(JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })).not.toContain("GHJK");
});

const GENERATE_FAILED = "Couldn't create a pairing code. Please try again.";
const ROTATE_FAILED = "Couldn't update the Bridge connection. Please try again.";
const BACKEND_TEXT = 'duplicate key value violates unique constraint "bridge_pairing_v2_code_hash_key" DETAIL: Key (code_hash)=(\\x00) Not the DJ for this event';

it.each(["123456", "", "0123456789ABCDEU", null])("refuses to display a non-v2 backend value %j", async code => {
  await generate(code);
  await waitFor(() => expect(m.error).toHaveBeenCalledWith(GENERATE_FAILED));
  expect(screen.queryByTestId("bridge-pairing-code")).toBeNull();
  expect(screen.getByRole("button", { name: /connect decks bridge/i })).toBeInTheDocument();
});

it("regenerates on request and replaces the displayed code", async () => {
  await generate(GROUPED);
  await screen.findByTestId("bridge-pairing-code");
  m.rpc.mockResolvedValue(reply("0123-4567-89AB-CDEF"));
  fireEvent.click(screen.getByRole("button", { name: /generate new code/i }));
  await waitFor(() => expect(screen.getByTestId("bridge-pairing-code").textContent).toBe("0123-4567-89AB-CDEF"));
  expect(m.rpc).toHaveBeenCalledTimes(2);
});

it("drops an expired code and offers a new one", async () => {
  await generate(GROUPED, new Date(Date.now() - 1000).toISOString());
  await waitFor(() => expect(screen.queryByTestId("bridge-pairing-code")).toBeNull());
  expect(screen.getByRole("button", { name: /connect decks bridge/i })).toBeInTheDocument();
});

it("shows an expiry countdown for a live code", async () => {
  await generate(GROUPED);
  await screen.findByTestId("bridge-pairing-code");
  expect(screen.getByText(/expires in/i).textContent).toMatch(/Expires in [45]:\d\d/);
});

it.each([
  ["an Error from the backend", { data: null, error: new Error(BACKEND_TEXT) }],
  ["a PostgREST-style error object", { data: null, error: { message: BACKEND_TEXT, details: BACKEND_TEXT, hint: BACKEND_TEXT, code: "23505" } }],
])("shows a generic message for %s and never the backend text", async (_label, result) => {
  m.rpc.mockResolvedValue(result);
  const { container } = render(<BridgePairing eventId={EVENT} />);
  fireEvent.click(screen.getByRole("button", { name: /connect decks bridge/i }));
  await waitFor(() => expect(m.error).toHaveBeenCalledTimes(1));
  expect(m.error).toHaveBeenCalledWith(GENERATE_FAILED);
  const shown = JSON.stringify(m.error.mock.calls) + JSON.stringify(m.success.mock.calls) + container.innerHTML;
  for (const leaked of ["duplicate key", "bridge_pairing_v2", "code_hash", "Not the DJ", "23505", "DETAIL"]) expect(shown).not.toContain(leaked);
  expect(screen.queryByTestId("bridge-pairing-code")).toBeNull();
});

it("shows a generic message when the request itself rejects", async () => {
  m.rpc.mockRejectedValue(new TypeError(`Failed to fetch ${BACKEND_TEXT}`));
  render(<BridgePairing eventId={EVENT} />);
  fireEvent.click(screen.getByRole("button", { name: /connect decks bridge/i }));
  await waitFor(() => expect(m.error).toHaveBeenCalledWith(GENERATE_FAILED));
  expect(JSON.stringify(m.error.mock.calls)).not.toContain("Failed to fetch");
});

it("shows a generic message when token rotation fails, never the backend text", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  m.rpc.mockResolvedValue({ data: null, error: new Error(BACKEND_TEXT) });
  render(<BridgePairing eventId={EVENT} />);
  fireEvent.click(screen.getByRole("button", { name: /regenerate token/i }));
  await waitFor(() => expect(m.error).toHaveBeenCalledWith(ROTATE_FAILED));
  expect(m.rpc).toHaveBeenCalledWith("regenerate_ingest_token", { _event_id: EVENT });
  expect(JSON.stringify(m.error.mock.calls)).not.toContain("duplicate key");
  vi.restoreAllMocks();
});
