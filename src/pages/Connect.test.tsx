import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Connect from "./Connect";

afterEach(() => { window.history.pushState({}, "", "/"); vi.restoreAllMocks(); });

it("never reads, renders or forwards a pairing code from the URL", () => {
  window.history.pushState({}, "", "/connect?code=123456&code=GHJK-MNPQ-RSTV-WXYZ#GHJK-MNPQ-RSTV-WXYZ");
  const { container } = render(<Connect />);
  expect(screen.getByText(/16-character code shown on the dashboard/i)).toBeInTheDocument();
  const html = container.innerHTML;
  for (const needle of ["123456", "GHJK", "decksbridge:", "?code=", "<iframe"]) expect(html).not.toContain(needle);
  expect(document.querySelector("iframe")).toBeNull();
});

it("explains that the updated Bridge is required and not yet available here", () => {
  render(<Connect />);
  expect(screen.getByRole("status").textContent).toMatch(/updated Decks Bridge is required/i);
  expect(screen.getByRole("status").textContent).toMatch(/not yet available from this staging page/i);
  expect(screen.queryByText(/download/i)).toBeNull();
});

it("offers no download, link, button or navigation of any kind", () => {
  const { container } = render(<Connect />);
  expect(container.querySelector("a, button, form, iframe, img, link, script, [href], [src]")).toBeNull();
  expect(container.innerHTML).not.toMatch(/linku99|https?:\/\/|decksbridge/i);
});

it("makes no network request, including to linku99.com", () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  const before = window.location.href;
  render(<Connect />);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  expect(window.location.href).toBe(before);
  vi.unstubAllGlobals();
});

it("source contains no code parameter, deep link, old download or URL at all", () => {
  const source = readFileSync("src/pages/Connect.tsx", "utf8");
  for (const needle of ["?code=", "decksbridge://", "linku99", "http://", "https://", "useSearchParams", "location.", "fetch(", "href", "window.open"]) {
    expect(source).not.toContain(needle);
  }
});
