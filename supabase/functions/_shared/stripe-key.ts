// Pure validation: no environment access, SDK import, logging or provider calls.
export function parseStripeKey(value: unknown): { key: string; mode: "test" | "live" } | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  const match = /^(?:sk|rk)_(test|live)_[A-Za-z0-9]+$/.exec(key);
  if (!match) return null;
  return { key, mode: match[1] === "live" ? "live" : "test" };
}

export function requireStripeKey(value: unknown): { key: string; mode: "test" | "live" } {
  if (value == null || (typeof value === "string" && !value.trim())) {
    throw new Error("STRIPE_SECRET_KEY not configured");
  }
  const parsed = parseStripeKey(value);
  if (!parsed) {
    throw new Error("STRIPE_SECRET_KEY must be a valid sk_test_, sk_live_, rk_test_ or rk_live_ key");
  }
  return parsed;
}