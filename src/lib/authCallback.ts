export function localNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || ([...raw].some(c => c.charCodeAt(0) <= 32) || raw.includes("\\"))) return "/";
  const parsed = new URL(raw, "https://local.invalid");
  return parsed.origin === "https://local.invalid" ? parsed.pathname + parsed.search + parsed.hash : "/";
}

export async function completeCallback(
  href: string,
  exchange: (code: string) => Promise<{ error: { message: string } | null }>,
  hasSession: () => Promise<boolean>,
): Promise<string> {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const error = url.searchParams.get("error") || hash.get('error') || url.searchParams.get("error_description") || hash.get("error_description");
  if (error) throw new Error('Confirmation or sign-in link is invalid or expired. Request a new link.');
  const code = url.searchParams.get("code");
  if (code) {
    const result = await exchange(code);
    if (result.error) throw new Error(result.error.message);
  }
  if (!await hasSession()) throw new Error('No verified account was found. Open a fresh confirmation link or sign in.');
  return localNext(url.searchParams.get("next"));
}