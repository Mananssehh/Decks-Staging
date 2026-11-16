import { describe, expect, it } from "vitest";
import { toCSV } from "./csv";

describe("CSV formula neutralization", () => {
  it.each(["=1+1", "+cmd", "-cmd", "@SUM(1)", "  =1", "\t=1", "\r=1", "\n=1", "\u0000=1"])("neutralizes %j", value => {
    const csv = toCSV([{ value }]);
    expect(csv.split("\n")[1].replace(/^"/, "").startsWith("'")).toBe(true);
  });
  it("protects headers too", () => expect(toCSV([{ "=bad": "ok" }])).toBe("'=bad\nok"));
  it("preserves typed numbers and ordinary text", () => {
    expect(toCSV([{ points: -15, nickname: "Guest", missing: null }])).toBe("points,nickname,missing\n-15,Guest,");
  });
  it("quotes CR, LF, commas and quotes after neutralization", () => {
    expect(toCSV([{ value: '=HYPERLINK("x","y")' }])).toBe('value\n"\'=HYPERLINK(""x"",""y"")"');
    expect(toCSV([{ value: "a\rb" }])).toBe('value\n"a\rb"');
  });
});