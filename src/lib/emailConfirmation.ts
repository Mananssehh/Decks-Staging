import { localNext } from './authCallback';

export const CONFIRMATION_COOLDOWN_MS = 60_000;
const key = 'decks:email-confirmation:v1';
export type PendingConfirmation = {
  email: string; next: string; type: 'signup' | 'email_change'; resendAt: number;
  legacyUserId?: string; nickname?: string;
};
export function confirmationRedirect(origin: string, next: string) {
  const url = new URL('/auth/callback', origin);
  url.searchParams.set('next', localNext(next));
  return url.href;
}
export function readConfirmation(): PendingConfirmation | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    return p && typeof p.email === 'string' && typeof p.next === 'string' &&
      ['signup', 'email_change'].includes(p.type) && typeof p.resendAt === 'number'
      ? { ...p, next: localNext(p.next) } : null;
  } catch { return null; }
}
export function saveConfirmation(p: PendingConfirmation | null) {
  if (p) sessionStorage.setItem(key, JSON.stringify(p));
  else sessionStorage.removeItem(key);
}
export function confirmedAccount(user: { email?: string; email_confirmed_at?: string; is_anonymous?: boolean } | null | undefined, email?: string) {
  return !!user && !user.is_anonymous && !!user.email_confirmed_at &&
    (!email || user.email?.trim().toLowerCase() === email.trim().toLowerCase());
}