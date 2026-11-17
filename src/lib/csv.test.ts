import { describe, expect, it } from "vitest";
import { toCSV } from "./csv";

describe("CSV formula neutralization", () => {
  it.each(["=1+1", "+cmd", "-cmd", "@SUM(1)", "  =1", "\t=1", "\r=1", "\n=1", "\u0000=1"])("neutralizes %j", value => {
    const csv = toCSV([{ value }]);
    expect(csv.split("\n")[1].replace(/^"/, "").startsWith("'")).toBe(true);
  });
  it("matches the original prefix rule for every UTF-16 code unit", () => {
    // Reference: the original /^[\s\u0000-\u001f]*[=+@-]/u rule, built at runtime.
    const reference = new RegExp(`^[\\s${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}]*[=+@-]`, "u");
    // Full expected cell under the original rule, including the unchanged quoting step.
    const original = (value: string) => {
      const cell = reference.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
      return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
    };
    const tails = ["=1", "+1", "@1", "-1", "x", "", " =1", "\u0001\t =1", "x=1"];
    const mismatches: string[] = [];
    for (let unit = 0; unit <= 0xffff; unit++) {
      const lead = String.fromCharCode(unit);
      for (const tail of tails) {
        for (const value of [lead + tail, lead + lead + tail, " " + lead + tail]) {
          if (toCSV([{ value }]) !== `value\n${original(value)}`) mismatches.push(JSON.stringify(value));
        }
      }
    }
    expect(mismatches).toEqual([]);
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