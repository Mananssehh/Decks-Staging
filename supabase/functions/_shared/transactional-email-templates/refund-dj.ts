import { Email } from './refund-dj.tsx'
import type { TemplateEntry } from './registry.ts'
export const template = {
  component: Email,
  subject: 'A tip on Decks was refunded',
  displayName: 'Refund notification (DJ)',
  previewData: {
    djName: 'Nova',
    guestName: 'Sam',
    eventName: 'Friday Night Set',
    grossAmountCents: 500,
    refundedAmountCents: 500,
    fullyRefunded: true,
  },
} satisfies TemplateEntry
