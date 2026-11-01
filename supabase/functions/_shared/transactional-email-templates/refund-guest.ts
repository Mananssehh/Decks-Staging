import { Email } from './refund-guest.tsx'
import type { TemplateEntry } from './registry.ts'
export const template = {
  component: Email,
  subject: 'Your tip was refunded',
  displayName: 'Refund notification (guest)',
  previewData: {
    djName: 'Nova',
    eventName: 'Friday Night Set',
    grossAmountCents: 500,
    refundedAmountCents: 500,
    fullyRefunded: true,
    receiptUrl: 'https://pay.stripe.com/receipts/example',
  },
} satisfies TemplateEntry
