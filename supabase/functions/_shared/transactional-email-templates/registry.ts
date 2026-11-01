/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

import { template as djTipNotification } from './dj-tip-notification.ts'
import { template as guestTipThankYou } from './guest-tip-thank-you.ts'
import { template as refundDj } from './refund-dj.ts'
import { template as refundGuest } from './refund-guest.ts'
import { template as weeklySummary } from './weekly-summary.ts'
import { template as guestWelcome } from './guest-welcome.ts'
import { template as djWelcome } from './dj-welcome.ts'
import { template as djStripeConnected } from './dj-stripe-connected.ts'
import { template as securityPasswordChanged } from './security-password-changed.ts'

export interface TemplateEntry {
  // deno-lint-ignore no-explicit-any
  component: React.ComponentType<never>
  subject: string | ((data: Record<string, unknown>) => string)
  displayName?: string
  // deno-lint-ignore no-explicit-any
  previewData?: Record<string, unknown>
  to?: string | ((data: Record<string, unknown>) => string)
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  'dj-tip-notification': djTipNotification,
  'guest-tip-thank-you': guestTipThankYou,
  'refund-dj': refundDj,
  'refund-guest': refundGuest,
  'weekly-summary': weeklySummary,
  'guest-welcome': guestWelcome,
  'dj-welcome': djWelcome,
  'dj-stripe-connected': djStripeConnected,
  'security-password-changed': securityPasswordChanged,
}
