// Provider diagnostics are operator-only; never trust client role metadata.
export async function authorizeDiagnostic(
  req: Request,
  verify: (token: string) => Promise<string | null>,
  isAdmin: (userId: string) => Promise<boolean>,
): Promise<401 | 403 | 503 | null> {
  const header = req.headers.get('authorization') ?? '';
  if (!/^Bearer \S+$/i.test(header)) return 401;
  try {
    const userId = await verify(header.slice(7));
    if (!userId) return 401;
    return await isAdmin(userId) ? null : 403;
  } catch {
    return 503;
  }
}