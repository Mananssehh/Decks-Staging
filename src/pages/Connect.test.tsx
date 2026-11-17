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
  // DOM-level: no interactive, navigational, download or resource-loading element or attribute.
  expect(container.querySelector(
    "area, input, select, textarea, object, embed, video, audio, source, base, meta, [role='link'], [role='button'], " +
    "[download], [action], [formaction], [srcset], [ping], [onclick], [target], [tabindex], [xlink\\:href]",
  )).toBeNull();
  const forbidden = /linku99|https?:\/\/|decksbridge|\/\//i;
  for (const el of Array.from(container.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      // An XML namespace declaration on the inline icon is not a link; it must be exactly the SVG namespace.
      if (attr.name === "xmlns") { expect(attr.value).toBe("http://www.w3.org/2000/svg"); continue; }
      expect(attr.name.startsWith("xmlns:"), `${el.tagName} ${attr.name}`).toBe(false);
      expect(attr.value, `${el.tagName} ${attr.name}`).not.toMatch(forbidden);
    }
  }
  expect(container.textContent ?? "").not.toMatch(forbidden);
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
