import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import ForgotPassword from "./ForgotPassword";

const m = vi.hoisted(() => ({ reset: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { resetPasswordForEmail: m.reset } } }));
vi.mock("@/components/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("sonner", () => ({ toast: { success: m.success, error: m.error } }));

const GENERIC = "If an account exists for that email, we've sent a reset link. Check your inbox.";
const submit = async (search = "") => {
  render(<MemoryRouter initialEntries={[`/forgot-password${search}`]}><ForgotPassword /></MemoryRouter>);
  const input = screen.getByLabelText(/email/i);
  fireEvent.change(input, { target: { value: "qa@example.test" } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  await waitFor(() => expect(m.reset).toHaveBeenCalledTimes(1));
};

beforeEach(() => { m.reset.mockReset().mockResolvedValue({ data: {}, error: null }); m.success.mockReset(); m.error.mockReset(); });

it("returns the reset link to the same origin at /reset-password, never production", async () => {
  await submit();
  const [email, options] = m.reset.mock.calls[0];
  expect(email).toBe("qa@example.test");
  expect(options.redirectTo).toBe(`${window.location.origin}/reset-password`);
  expect(new URL(options.redirectTo).origin).toBe(window.location.origin);
  expect(options.redirectTo).not.toContain("linku99");
});

it("ignores attacker-controlled next/redirect parameters (no open redirect)", async () => {
  await submit("?next=https://evil.example/reset-password&redirect_to=//evil.example&redirectTo=https://linku99.com/reset-password");
  expect(m.reset.mock.calls[0][1].redirectTo).toBe(`${window.location.origin}/reset-password`);
});

it("keeps the generic response whether or not the request fails", async () => {
  await submit();
  await waitFor(() => expect(m.success).toHaveBeenCalledWith(GENERIC));
  m.reset.mockReset().mockRejectedValue(new Error("User not found"));
  m.success.mockReset();
  document.body.innerHTML = "";
  await submit();
  await waitFor(() => expect(m.success).toHaveBeenCalledWith(GENERIC));
  expect(m.error).not.toHaveBeenCalled();
});
