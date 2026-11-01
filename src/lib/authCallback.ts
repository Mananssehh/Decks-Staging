export function localNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u0020]/.test(raw)) return "/";
  const parsed = new URL(raw, "https://local.invalid");
  return parsed.origin === "https://local.invalid" ? parsed.pathname + parsed.search + parsed.hash : "/";
}

export async function completeCallback(
  href: string,
  exchange: (code: string) => Promise<{ error: { message: string } | null }>,
  hasSession: () => Promise<boolean>,
): Promise<string> {
  const url = new URL(href);
  const error = url.searchParams.get("error_description") || new URLSearchParams(url.hash.slice(1)).get("error_description");
  if (error) throw new Error(error);
  const code = url.searchParams.get("code");
  if (code) {
    const result = await exchange(code);
    if (result.error) throw new Error(result.error.message);
  }
  return await hasSession() ? localNext(url.searchParams.get("next")) : "/auth";
}