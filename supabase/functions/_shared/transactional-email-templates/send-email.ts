/** Fail-closed staging adapter. Replace with the official domain scaffold only after setup.
 * There is deliberately no sending SDK import, network call, queue or delivery marker.
 */
export const APP_EMAIL_TEMPLATES = ["guest-welcome", "dj-welcome", "dj-stripe-connected", "dj-tip-notification", "guest-tip-thank-you", "refund-dj", "refund-guest"] as const;
export type AppEmailTemplate = typeof APP_EMAIL_TEMPLATES[number];
export async function sendTemplateEmail(
  template: AppEmailTemplate,
  _recipient: string,
  _options: { templateData: Record<string, unknown>; idempotencyKey: string },
): Promise<{ sent: false; reason: "domain_not_configured" }> {
  if (!APP_EMAIL_TEMPLATES.includes(template)) throw new Error("Unsupported app email");
  return { sent: false, reason: "domain_not_configured" };
}