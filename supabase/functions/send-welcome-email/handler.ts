export interface WelcomeUser { id: string; email?: string; email_confirmed_at?: string; is_anonymous?: boolean }
export interface WelcomeDeps {
  user: (token: string) => Promise<WelcomeUser | null>;
  isDJ: (id: string) => Promise<boolean>;
}
export async function handleWelcome(req: Request, deps: WelcomeDeps): Promise<{ status: number; body: object }> {
  if (req.method !== "POST") return {status:405,body:{error:"Method not allowed"}};
  const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return {status:401,body:{error:"Sign in required"}};
  try {
    const user = await deps.user(token);
    if (!user) return {status:401,body:{error:"Sign in required"}};
    if (user.is_anonymous || !user.email || !user.email_confirmed_at) return {status:400,body:{sent:false,reason:"verified_email_required"}};
    const body = await req.json() as {kind?:unknown};
    if (body.kind !== "guest" && body.kind !== "dj") return {status:400,body:{error:"Invalid welcome kind"}};
    if (body.kind === "dj" && !await deps.isDJ(user.id)) return {status:403,body:{error:"DJ activation required"}};
    // No domain: no provider request or durable 'sent' marker. Repeated requests remain no-ops.
    return {status:200,body:{sent:false,reason:"domain_not_configured"}};
  } catch { return {status:503,body:{sent:false,reason:"service_unavailable"}}; }
}