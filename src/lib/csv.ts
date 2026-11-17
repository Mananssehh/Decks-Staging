/** True when a formula trigger (= + @ -) follows any run of leading whitespace or C0 control characters (U+0000-U+001F). */
function hiddenFormulaPrefix(raw: string): boolean {
  let i = 0;
  while (i < raw.length && (raw.charCodeAt(i) <= 0x1f || /\s/.test(raw[i]))) i++;
  return i < raw.length && "=+@-".includes(raw[i]);
}

function escape(v: unknown): string {
  if (v === null || v === undefined) return "";
  // Treat untrusted text as text, including prefixes hidden behind whitespace.
  // Numeric values remain numeric (notably negative ledger amounts).
  const raw = String(v);
  const s = typeof v === "string" && (hiddenFormulaPrefix(raw) || /^[\t\r\n]/.test(raw))
    ? `'${raw}` : raw;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV<T extends Record<string, unknown>>(rows: T[], columns?: (keyof T)[]): string {
  if (!rows.length) return "";
  const cols = (columns ?? (Object.keys(rows[0]) as (keyof T)[])) as string[];
  const head = cols.map(escape).join(",");
  const body = rows.map((r) => cols.map((c) => escape((r as Record<string, unknown>)[c])).join(",")).join("\n");
  return `${head}\n${body}`;
}

export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
